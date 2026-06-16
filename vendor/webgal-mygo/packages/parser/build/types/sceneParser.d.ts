import { commandType, IAsset, IScene } from './interface/sceneInterface';
import { fileType } from './interface/assets';
import { ConfigMap } from './config/scriptConfig';
/**
 * 场景解析器
 * @param rawScene 原始场景
 * @param sceneName 场景名称
 * @param sceneUrl 场景url
 * @param assetsPrefetcher
 * @param assetSetter
 * @param ADD_NEXT_ARG_LIST
 * @param SCRIPT_CONFIG_MAP
 * @return {IScene} 解析后的场景
 */
export declare const sceneParser: (rawScene: string, sceneName: string, sceneUrl: string, assetsPrefetcher: (assetList: Array<IAsset>) => void, assetSetter: (fileName: string, assetType: fileType) => string, ADD_NEXT_ARG_LIST: commandType[], SCRIPT_CONFIG_MAP: ConfigMap) => IScene;
