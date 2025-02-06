import { GetLocalAddress } from './helpers';
import PeerSSDP from './lib/PeerSSDP';

export function SetupSSDP() {
    const peer = new PeerSSDP();

    peer.on('ready', () => console.log('[SSDP] Ready'));
    peer.on('error', console.error);
    peer.on('listening', (type, address, port) => console.log(`[SSDP] Listening [${type}, ${address}, ${port}]`));

    peer.on('search', (headers, address) => {
        if(typeof headers.ST === "string" && headers.ST.includes('dial-multiscreen-org:service:dial:1'))
            peer.reply({
                LOCATION: `http://${GetLocalAddress()}:8008/ssdp/device-desc.xml`,
                ST: `urn:dial-multiscreen-org:service:dial:1`,
                'CONFIGID.UPNP.ORG': 7337,
                'BOOTID.UPNP.ORG': 7337,
                USN: `uuid:${process.env.UUID}`
            }, address);
    })

    peer.start();
}