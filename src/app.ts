import { parseVariables } from "helpers";
import fs from 'node:fs/promises';
import { join } from "node:path";
import type { Express } from "express";

export default class App {
    state: 'running' | 'stopped' = 'stopped';
    name: string;
    url: string;
    protocols: string[];
    link: string = '';

    constructor(name: string, url: string, protocols: string[] = ['ramp']) {
        this.name = name;
        this.url = url;
        this.protocols = protocols;
    }

    public registerApi(http: Express): void {
        http.get(`/apps/${this.name}`, async (req, res) => {
            const file = await fs.readFile(join(process.cwd(), 'static/app.xml'));
            console.log(`[CAST] ${req.ip} requested app ${this.name}`);
            res.appendHeader('Content-Type', 'application/xml');
            res.send(parseVariables(file, {
                name: this.name,
                protocols: this.protocols.map(item => `<protocol>${item}</protocol>`).join(''),
                state: this.state,
                link: this.link
            }));
        });
        http.post(`/apps/${this.name}`, async (req, res) => {
            console.log(req.body)
        });
    }
}
