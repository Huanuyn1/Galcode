import { commandType } from '../interface/sceneInterface';
export declare const SCRIPT_CONFIG: {
    scriptString: string;
    scriptType: commandType;
}[];
export declare const ADD_NEXT_ARG_LIST: commandType[];
export type ConfigMap = Map<string, ConfigItem>;
export type ConfigItem = {
    scriptString: string;
    scriptType: commandType;
};
