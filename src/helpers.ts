import os from 'node:os';

export function GetLocalAddress(): string {
    const interfaces = os.networkInterfaces();
    for(const key in interfaces)
        for(const info of (interfaces[key] || []))
            if(info.family === 'IPv4' && !info.internal)
                return info.address;
    throw new Error('Cannot find local ipv4 address');
}

export function parseVariables(response: string | Buffer, variables: Record<string, any> = {}): string {
    response = response.toString();
    for(const [key, value] of Object.entries({ ...variables, uuid: process.env.UUID }))
        response = response.replace(`#${key}#`, value);
    return response;
}