/**
 * 子场景结束后回到父场景的入口
 * @interface sceneEntry
 */
export interface sceneEntry {
    sceneName: string;
    sceneUrl: string;
    continueLine: number;
}
/**
 * 场景栈条目接口 (兼容性别名)
 * @interface ISceneEntry
 */
export interface ISceneEntry extends sceneEntry {
}
