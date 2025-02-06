import { createSocket, RemoteInfo, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { networkInterfaces } from 'node:os';
import util from 'node:util';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SSDP_HOST = `${SSDP_ADDRESS}:${SSDP_PORT}`;
const MAX_AGE = 'max-age=1800';
const TTL = 128;
const MX = 2;
const ALIVE = 'ssdp:alive';
const BYEBYE = 'ssdp:byebye';
const UPDATE = 'ssdp:update';
const TYPE_M_SEARCH = 'M-SEARCH';
const TYPE_NOTIFY = 'NOTIFY';
const TYPE_200_OK = '200 OK';

type SSDP_MESSAGE_TYPE = 'found' | 'search' | 'notify' | null;
type SOCKET_TYPE = 'multicast' | 'unicast';

interface EventMap {
    ready: []
    listening: [type: SOCKET_TYPE, address: string, port: number]
    close: []
    found: [headers: Record<string, any>, address: RemoteInfo]
    notify: [headers: Record<string, any>, address: RemoteInfo]
    search: [headers: Record<string, any>, address: RemoteInfo]
    error: [Error]
}

export default class PeerSSDP extends EventEmitter<EventMap> {
    #socketMap: Record<string, Record<SOCKET_TYPE, Socket | undefined>> = {};
    #interfaceInterval: NodeJS.Timeout | undefined;
    #ready: number = 0;
    multicastSocket: any;
    unicastSocket: any;

    public start(): PeerSSDP {
        this.startInterfaceScan();
        return this;
    }

    public close(): void {
        this.stopInterfaceScan();
        this.socketClose('multicast');
        this.socketClose('unicast');
    }
    
    public notify(headers: Record<string, any> = {}, callback?: (error: Error | null, bytes: number) => void): void {
        headers['HOST'] = headers['HOST'] || SSDP_HOST;
        headers['CACHE-CONTROL'] = headers['CACHE-CONTROL'] || MAX_AGE;
        headers['EXT'] = headers['EXT'] || '';
        headers['DATE'] = headers['DATE'] || new Date().toUTCString();
        this.socketSend('multicast', (address) => [Buffer.from(this.serialize(`${TYPE_NOTIFY}  * HTTP/1.1`, headers, address)), SSDP_PORT, SSDP_ADDRESS, callback]);
    }

    public alive(headers: Record<string, any> = {}, callback?: (error: Error | null, bytes: number) => void): void {
        headers['NTS'] = ALIVE;
        this.notify(headers, callback);
    }

    public byebye(headers: Record<string, any> = {}, callback?: (error: Error | null, bytes: number) => void): void {
        headers['NTS'] = BYEBYE;
        this.notify(headers, callback);
    }

    public update(headers: Record<string, any> = {}, callback?: (error: Error | null, bytes: number) => void): void {
        headers['NTS'] = UPDATE;
        this.notify(headers, callback);
    }

    public search(headers: Record<string, any> = {}, callback?: (error: Error | null, bytes: number) => void): void {
        headers['HOST'] = headers['HOST'] || SSDP_HOST;
        headers['MAN'] = '"ssdp:discover"';
        headers['MX'] = headers['MX'] || MX;
        this.socketSend('unicast', (address) => [Buffer.from(this.serialize(`${TYPE_M_SEARCH}  * HTTP/1.1`, headers, address)), SSDP_PORT, SSDP_ADDRESS, callback]);
    }

    public reply(headers: Record<string, any> = {}, replyAddress: RemoteInfo, callback?: (error: Error | null, bytes: number) => void): void {
        headers['HOST'] = headers['HOST'] || SSDP_HOST;
        headers['CACHE-CONTROL'] = headers['CACHE-CONTROL'] || MAX_AGE;
        headers['EXT'] = headers['EXT'] || '';
        headers['DATE'] = headers['DATE'] || new Date().toUTCString();
        this.socketSend('unicast', (address) => [Buffer.from(this.serialize(`HTTP/1.1 ${TYPE_200_OK}`, headers, address)), replyAddress.port, replyAddress.address, callback]);
    }

    private socketClose(type: SOCKET_TYPE): void {
        for(const key in this.#socketMap)
            if(this.#socketMap[key][type]) {
                this.#socketMap[key][type].close();
                delete this.#socketMap[key][type];
            }
    }

    private socketSend(type: SOCKET_TYPE, message: (address: string) => [msg: string | NodeJS.ArrayBufferView | readonly any[], port?: number, address?: string, callback?: (error: Error | null, bytes: number) => void]): void {
        for(const key in this.#socketMap)
            if(this.#socketMap[key][type]) {
                const args = message(key);
                this.#socketMap[key][type].send(...args);
            }
    }

    private performInterfaceScan(): void {
        let addresses: string[] = [];
        const interfaces = networkInterfaces();
        for(const key in interfaces)
            for(const interfaceInfo of (interfaces[key] || []))
                if(interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
                    if(typeof this.#socketMap[interfaceInfo.address] === "undefined")
                        this.startSocket(interfaceInfo.address);
                    addresses.push(interfaceInfo.address);
                }
        for(const key in this.#socketMap)
            if(!addresses.includes(key))
                this.closeSocket(key);
    }

    private stopInterfaceScan() {
        if(typeof this.#interfaceInterval === "undefined") return;
        clearInterval(this.#interfaceInterval);
        this.#interfaceInterval = undefined;
    }

    private startInterfaceScan() {
        if(typeof this.#interfaceInterval !== "undefined")
            this.stopInterfaceScan();
        this.performInterfaceScan();
        this.#interfaceInterval = setInterval(() => this.performInterfaceScan(), 15000);
    }

    private onMessage(msg: Buffer<ArrayBufferLike>, rinfo: RemoteInfo): void {
        const req = this.deserialize(msg);
        if(!req.type) return;
        this.emit(req.type, req.headers, rinfo);
    }

    private onClose(): void {
        if(--this.#ready <= 0) {
            this.emit('close');
            this.#ready = 0;
        }
    }

    private onReady(): void {
        if(++this.#ready === 1)
            this.emit('ready');
    }

    private onBind(socket: Socket, address: string, instance: PeerSSDP, isMulticast: boolean): () => void {
        return () => {
            socket.setMulticastTTL(TTL);
            if(isMulticast) {
                socket.setBroadcast(true);
                socket.addMembership(SSDP_ADDRESS, address);
                socket.setMulticastLoopback(true);
            }
            instance.onReady();
        }
    }

    private startSocket(address: string): void {
        this.#socketMap[address] = {
            multicast: createSocket({ type: 'udp4', reuseAddr: true }),
            unicast: createSocket({ type: 'udp4', reuseAddr: true })
        };

        if(!this.#socketMap[address].multicast || !this.#socketMap[address].unicast) return;

        this.#socketMap[address].multicast.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
        this.#socketMap[address].multicast.on('listening', () => this.emit('listening', 'multicast', address, SSDP_PORT));
        this.#socketMap[address].multicast.on('error', err => this.emit('error', err));
        this.#socketMap[address].multicast.on('close', () => this.onClose());
        this.#socketMap[address].multicast.bind(SSDP_PORT, address, this.onBind(this.#socketMap[address].multicast, address, this, true));

        const UNICAST_PORT = 50000 + Math.floor(Math.random() * 1000);

        this.#socketMap[address].unicast.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
        this.#socketMap[address].unicast.on('listening', () => this.emit('listening', 'unicast', address, UNICAST_PORT));
        this.#socketMap[address].unicast.on('error', err => this.emit('error', err));
        this.#socketMap[address].unicast.on('close', () => this.onClose());
        this.#socketMap[address].unicast.bind(UNICAST_PORT, address, this.onBind(this.#socketMap[address].unicast, address, this, false));
    }

    private closeSocket(address: string): void {
        if(typeof this.#socketMap[address] === "undefined") return;
        if(this.#socketMap[address].multicast)
            this.#socketMap[address].multicast.close();
        if(this.#socketMap[address].unicast)
            this.#socketMap[address].unicast.close();
        delete this.#socketMap[address];
    }

    private deserialize(msg: Buffer): { type: SSDP_MESSAGE_TYPE, headers: Record<string, any> } {
        const lines = msg.toString().split('\r\n');
        const firstLine = lines.shift();
        if(!firstLine)
            return { type: null, headers: {} };
        let headers: Record<string, any> = {};
        let type: SSDP_MESSAGE_TYPE = null;
        if(firstLine?.match(/HTTP\/(\d{1})\.(\d{1}) (\d+) (.*)/))
            type = 'found';
        else {
            const split = firstLine.split(' ');
            if(split.length === 0)
                return { type: null, headers: {} };
            type = (split[0] === TYPE_M_SEARCH ? 'search' : (split[0] === TYPE_NOTIFY ? 'notify' : null));
        }
        for(const line of lines)
            if(line.length) {
                const headerMatch = line.match(/^([^:]+):\s*(.*)$/);
                if(headerMatch && headerMatch.length === 3)
                    headers[headerMatch[1].toUpperCase()] = headerMatch[2];
            }
        return {
            type,
            headers
        }
    }

    private serialize(head: string, headers: Record<string, any>, address: string): string {
        let result = `${head}\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`;
        if(address)
            result = result.replace(/{{networkInterfaceAddress}}/g, address);
        return result;
    }
}