declare global {
    namespace NodeJS {
        interface ProcessEnv {
            UUID: string;
            NAME: string;
        }
    }
}

export { };