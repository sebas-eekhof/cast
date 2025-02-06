import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs/promises';
import express from 'express';
import { SetupSSDP } from './ssdp';
import { join } from 'node:path';
import { parseVariables } from './helpers';
import App from './app';
import WebSocket from 'websocket';
import NodeHTTP from 'node:http';

process.env.UUID = uuidv4();
process.env.NAME = 'TestCast';

const apps = [
    new App('YouTube', 'https://www.youtube.com/tv?$query'),
    new App('com.spotify.Spotify.TVv2', ''),
    new App('NetFlix', '')
];

const http = express();

http.disable('x-powered-by');

const httpServer = NodeHTTP.createServer(http);

const wsServer = new WebSocket.server({
    httpServer,
    autoAcceptConnections: true
});

const wsRouter = new WebSocket.router();
wsRouter.attachServer(wsServer);

wsServer.on('connect', req => {
    console.log('WS CONNECTION')
});

wsRouter.mount('/stage', '', req => {
    console.log('WS /stage')
});

wsRouter.mount('/system/control', '', req => {
    console.log('WS /system/control')
});

wsRouter.mount('/connection', '', req => {
    console.log('WS /connection')
});

for(const app of apps)
    app.registerApi(http);

http.get('/', async (req, res) => {
    res.send({ ok: true });
});

http.get('/setup/eureka_info', (req, res) => {
    res.send({
        bssid: '',
        build_version: '446070',
        cast_build_revision: '3.72.446070',
        connected: true,
        ethernet_connected: false,
        has_update: false,
        hotspot_bssid: '00:00:00:00:00:00',
        ip_address: (req.headers.host || '').includes(':') ? (req.headers.host || '').split(':')[0] : '127.0.0.1',
        locale: 'nl',
        location: {
            country_code: 'US',
            latitude: 255.0,
            longitude: 255.0
        },
        mac_address: '00:00:00:00:00:00',
        name: process.env.NAME,
        opt_in: {
            crash: true,
            opencast: false,
            stats: true
        },
        public_key: '',
        release_track: '',
        setup_state: 60,
        setup_stats: {
            historically_succeeded: true,
            num_check_connectivity: 0,
            num_connect_wifi: 0,
            num_connected_wifi_not_saved: 0,
            num_initial_eureka_info: 0,
            num_obtain_ip: 0
        },
        ssdp_udn: process.env.UUID,
        ssid: '',
        time_format: 1,
        tos_accepted: true,
        uma_client_id: process.env.UUID,
        uptime: 1,
        version: 12,
        wpa_configured: false,
        wpa_state: 0
    });
});

http.get('/ssdp/device-desc.xml', async (req, res) => {
    const file = await fs.readFile(join(process.cwd(), 'static/device_desc.xml'));
    res.appendHeader('Application-Url', `http://${req.headers.host}/apps`);
    res.appendHeader('Content-Type', 'application/xml');
    res.send(parseVariables(file, {
        base: `http://${req.headers.host}`,
        name: process.env.NAME
    }))
});

http.get('/apps/:app', (req, res) => {
    console.log(req.params)
});

http.get('/apps', (_, res) => {
    res.status(204);
    res.send(undefined);
});

http.post('/connection/:app', (req, res) => {

});

http.all('*', (req, res) => {
    console.log(`[${req.method}] ${req.url}`)
    res.send(undefined);
})

http.listen(8008);

SetupSSDP();