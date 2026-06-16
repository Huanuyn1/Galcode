interface IOptionItem {
    key: string;
    value: string | number | boolean;
}
interface IConfigItem {
    command: string;
    args: string[];
    options: IOptionItem[];
}
export type WebgalConfig = IConfigItem[];
export declare function configParser(configText: string): WebgalConfig;
export {};
