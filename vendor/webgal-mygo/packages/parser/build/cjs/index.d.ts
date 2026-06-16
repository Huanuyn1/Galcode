import { ADD_NEXT_ARG_LIST, SCRIPT_CONFIG, ConfigMap, ConfigItem } from './config/scriptConfig';
import { WebgalConfig } from './configParser/configParser';
import { fileType } from './interface/assets';
import { IAsset } from './interface/sceneInterface';
import { IWebGALStyleObj } from "./styleParser";
import { sceneTextPreProcess } from "./sceneTextPreProcessor";
export default class SceneParser {
    private readonly assetsPrefetcher;
    private readonly assetSetter;
    private readonly ADD_NEXT_ARG_LIST;
    private readonly SCRIPT_CONFIG_MAP;
    constructor(assetsPrefetcher: (assetList: IAsset[]) => void, assetSetter: (fileName: string, assetType: fileType) => string, ADD_NEXT_ARG_LIST: number[], SCRIPT_CONFIG_INPUT: ConfigItem[] | ConfigMap);
    /**
     * 解析场景
     * @param rawScene 原始场景
     * @param sceneName 场景名称
     * @param sceneUrl 场景url
     * @return 解析后的场景
     */
    parse(rawScene: string, sceneName: string, sceneUrl: string): import("./interface/sceneInterface").IScene;
    parseConfig(configText: string): WebgalConfig;
    stringifyConfig(config: WebgalConfig): string;
    parseScssToWebgalStyleObj(scssString: string): IWebGALStyleObj;
}
export { ADD_NEXT_ARG_LIST, SCRIPT_CONFIG };
export { sceneTextPreProcess };
