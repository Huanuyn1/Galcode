import { ConfigMap } from '../config/scriptConfig';
import { commandType, parsedCommand } from '../interface/sceneInterface';
/**
 * 处理命令
 * @param commandRaw
 * @param ADD_NEXT_ARG_LIST
 * @param SCRIPT_CONFIG_MAP
 * @return {parsedCommand} 处理后的命令
 */
export declare const commandParser: (commandRaw: string, ADD_NEXT_ARG_LIST: commandType[], SCRIPT_CONFIG_MAP: ConfigMap) => parsedCommand;
