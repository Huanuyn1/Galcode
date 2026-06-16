import { commandType, ISentence } from '../interface/sceneInterface';
import { ConfigMap } from '../config/scriptConfig';
/**
 * 语句解析器
 * @param sentenceRaw 原始语句
 * @param assetSetter
 * @param ADD_NEXT_ARG_LIST
 * @param SCRIPT_CONFIG_MAP
 */
export declare const scriptParser: (sentenceRaw: string, assetSetter: any, ADD_NEXT_ARG_LIST: commandType[], SCRIPT_CONFIG_MAP: ConfigMap) => ISentence;
