export interface IWebGALStyleObj {
    classNameStyles: Record<string, string>;
    others: string;
}
export declare function scss2cssinjsParser(scssString: string): IWebGALStyleObj;
