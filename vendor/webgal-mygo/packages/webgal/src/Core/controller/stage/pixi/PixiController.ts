import { webgalStore } from '@/store/store';
import { IEffect, IFigureAssociatedAnimation, IFigureMetadata, ITransform } from '@/store/stageInterface';
import { setStage, stageActions } from '@/store/stageReducer';
import { Live2D, WebGAL } from '@/Core/WebGAL';
import { baseBlinkParam, baseFocusParam, BlinkParam, FocusParam } from '@/Core/live2DCore';
import { isIOS } from '@/Core/initializeScript';
import { WebGALPixiContainer } from '@/Core/controller/stage/pixi/WebGALPixiContainer';
import { addSpineBgImpl, addSpineFigureImpl } from '@/Core/controller/stage/pixi/spine';
import { logger } from '@/Core/util/logger';
import { v4 as uuid } from 'uuid';
import { cloneDeep, isEqual } from 'lodash';
import * as PIXI from 'pixi.js';
import { INSTALLED } from 'pixi.js';
import { GifResource } from './GifResource';
import { AnimatedGIF } from '@pixi/gif';

export interface IAnimationObject {
  setStartState: Function;
  setEndState: Function;
  tickerFunc: PIXI.TickerCallback<number>;
  getEndStateEffect?: Function;
  forceStopWithoutSetEndState?: Function;
}

interface IStageAnimationObject {
  // 唯一标识
  uuid: string;
  // 一般与作用目标有关
  key: string;
  targetKey?: string;
  type: 'common' | 'preset';
  animationObject: IAnimationObject;
}

export interface IStageObject {
  // 唯一标识
  uuid: string;
  // 一般与作用目标有关
  key: string;
  pixiContainer: WebGALPixiContainer | null;
  // 相关的源 url
  sourceUrl: string;
  sourceExt: string;
  sourceType: 'img' | 'live2d' | 'spine' | 'gif' | 'video' | 'stage';
  spineAnimation?: string;
  isExiting?: boolean;
}

export interface ILive2DRecord {
  target: string;
  motion: string;
  expression: string;
  blink: BlinkParam;
  focus: FocusParam;
}

// export interface IRegisterTickerOpr {
//   tickerGeneratorFn: (targetKey: string, duration: number) => PIXI.TickerCallback<number>;
//   key: string;
//   target: string;
//   duration: number;
// }

interface SetContainerInitialPositionOptions {
  container: WebGALPixiContainer;
  childContainer: any;
  originalWidth: number;
  originalHeight: number;
  position: 'center' | 'left' | 'right' | 'bg';
  isLive2DFigure: boolean;
  overrideBounds?: [number, number, number, number];
  transform?: {
    xOffset?: number;
    yOffset?: number;
    xScale?: number;
    yScale?: number;
  };
  isJsonlFigure?: boolean;
}

// @ts-ignore
window.PIXI = PIXI;

INSTALLED.push(GifResource);

export default class PixiStage {
  public static assignTransform<T extends ITransform>(target: T, source?: ITransform, convertAlpha = true) {
    if (!source) return;
    const targetScale = target.scale;
    const targetPosition = target.position;
    if (target.scale) Object.assign(targetScale, source.scale);
    if (target.position) Object.assign(targetPosition, source.position);
    Object.assign(target, source);
    target.scale = targetScale;
    target.position = targetPosition;
    if (convertAlpha) {
      const sourceAlpha = source.alpha;
      if (sourceAlpha !== undefined) {
        target.alpha = 1;
        (target as any).alphaFilterVal = sourceAlpha;
      }
    }
  }

  /**
   * 当前的 PIXI App
   */
  public currentApp: PIXI.Application | null = null;
  public readonly mainStageContainer: WebGALPixiContainer;
  public readonly foregroundEffectsContainer: PIXI.Container;
  public readonly backgroundEffectsContainer: PIXI.Container;
  public frameDuration = 16.67;
  public notUpdateBacklogEffects = false;
  public readonly figureContainer: PIXI.Container;
  public figureObjects: Array<IStageObject> = [];
  public stageWidth = WebGAL.stageWidth;
  public stageHeight = WebGAL.stageHeight;
  public assetLoader = new PIXI.Loader();
  public readonly backgroundContainer: PIXI.Container;
  public backgroundObjects: Array<IStageObject> = [];
  public mainStageObject: IStageObject;
  /**
   * 添加 Spine 立绘
   * @param key 立绘的标识，一般和立绘位置有关
   * @param url 立绘图片url
   * @param presetPosition
   */
  public addSpineFigure = addSpineFigureImpl.bind(this);
  public addSpineBg = addSpineBgImpl.bind(this);
  // 注册到 Ticker 上的函数
  private stageAnimations: Array<IStageAnimationObject> = [];
  private loadQueue: { url: string; callback: () => void; name?: string }[] = [];
  private live2dFigureRecorder: Array<ILive2DRecord> = [];
  // 存储当前口型值，用于在motion更新后重新应用
  private currentMouthValues: Map<string, number> = new Map();
  // 锁定变换对象（对象可能正在执行动画，不能应用变换）
  private lockTransformTarget: Array<string> = [];

  /**
   * 暂时没用上，以后可能用
   * @private
   */
  private MAX_TEX_COUNT = 10;

  private figureCash: any;
  public constructor() {
    const app = new PIXI.Application({
      backgroundAlpha: 0,
      preserveDrawingBuffer: true,
    });
    // @ts-ignore

    window.PIXIapp = this; // @ts-ignore
    window.__PIXI_APP__ = app;
    // 清空原节点
    const pixiContainer = document.getElementById('pixiContianer');
    if (pixiContainer) {
      pixiContainer.innerHTML = '';
      pixiContainer.appendChild(app.view);
    }

    // 设置样式
    app.renderer.view.style.position = 'absolute';
    app.renderer.view.style.display = 'block';
    app.renderer.view.id = 'pixiCanvas';
    // @ts-ignore
    app.renderer.autoResize = true;
    app.renderer.resize(this.stageWidth, this.stageHeight);
    if (isIOS) {
      app.renderer.view.style.zIndex = '-5';
    }

    // 添加主舞台容器
    this.mainStageContainer = new WebGALPixiContainer();
    // 设置可排序
    this.mainStageContainer.sortableChildren = true;
    this.mainStageContainer.setBaseX(this.stageWidth / 2);
    this.mainStageContainer.setBaseY(this.stageHeight / 2);
    this.mainStageContainer.pivot.set(this.stageWidth / 2, this.stageHeight / 2);
    app.stage.addChild(this.mainStageContainer);

    this.mainStageObject = {
      uuid: uuid(),
      key: 'stage-main',
      pixiContainer: this.mainStageContainer,
      sourceUrl: '',
      sourceType: 'stage',
      sourceExt: '',
    };

    // 添加 4 个 Container 用于做渲染
    this.foregroundEffectsContainer = new PIXI.Container(); // 前景特效
    this.foregroundEffectsContainer.zIndex = 3;
    this.figureContainer = new PIXI.Container();
    this.figureContainer.sortableChildren = true; // 允许立绘启用 z-index
    this.figureContainer.zIndex = 2;
    this.backgroundEffectsContainer = new PIXI.Container(); // 背景特效
    this.backgroundEffectsContainer.zIndex = 1;
    this.backgroundContainer = new PIXI.Container();
    this.backgroundContainer.zIndex = 0;
    this.mainStageContainer.addChild(
      this.foregroundEffectsContainer,
      this.figureContainer,
      this.backgroundEffectsContainer,
      this.backgroundContainer,
    );
    this.currentApp = app;
    // 每 5s 获取帧率，并且防 loader 死
    const update = () => {
      this.updateFps();
      setTimeout(update, 10000);
    };
    update();
    // loader 防死
    const reload = () => {
      setTimeout(reload, 500);
      this.callLoader();
    };
    reload();
    this.initialize().then(() => {});
  }

  public getFigureObjects() {
    return this.figureObjects;
  }

  public getAllLockedObject() {
    return this.lockTransformTarget;
  }

  /**
   * 注册动画
   * @param animationObject
   * @param key
   * @param target
   */
  public registerAnimation(animationObject: IAnimationObject | null, key: string, target = 'default') {
    if (!animationObject) return;
    this.stageAnimations.push({ uuid: uuid(), animationObject, key: key, targetKey: target, type: 'common' });
    // 上锁
    this.lockStageObject(target);
    animationObject.setStartState();
    this.currentApp?.ticker.add(animationObject.tickerFunc);
  }

  /**
   * 注册预设动画
   * @param animationObject
   * @param key
   * @param target
   * @param currentEffects
   */
  // eslint-disable-next-line max-params
  public registerPresetAnimation(
    animationObject: IAnimationObject | null,
    key: string,
    target = 'default',
    currentEffects: IEffect[],
  ) {
    if (!animationObject) return;
    const effect = currentEffects.find((effect) => effect.target === target);
    if (effect) {
      const targetPixiContainer = this.getStageObjByKey(target);
      if (targetPixiContainer) {
        const container = targetPixiContainer.pixiContainer;
        if (container) PixiStage.assignTransform(container, effect.transform);
      }
      return;
    }
    this.stageAnimations.push({ uuid: uuid(), animationObject, key: key, targetKey: target, type: 'preset' });
    // 上锁
    this.lockStageObject(target);
    animationObject.setStartState();
    this.currentApp?.ticker.add(animationObject.tickerFunc);
  }

  public stopPresetAnimationOnTarget(target: string) {
    const targetPresetAnimations = this.stageAnimations.find((e) => e.targetKey === target && e.type === 'preset');
    if (targetPresetAnimations) {
      this.removeAnimation(targetPresetAnimations.key);
    }
  }

  /**
   * 移除动画
   * @param key
   */
  public removeAnimationByIndex(index: number) {
    if (index >= 0) {
      const thisTickerFunc = this.stageAnimations[index];
      this.currentApp?.ticker.remove(thisTickerFunc.animationObject.tickerFunc);
      thisTickerFunc.animationObject.setEndState();
      this.unlockStageObject(thisTickerFunc.targetKey ?? 'default');
      this.stageAnimations.splice(index, 1);
    }
  }

  public removeAnimationWithoutSetEndState(key: string) {
    const index = this.stageAnimations.findIndex((e) => e.key === key);
    if (index >= 0) {
      const thisTickerFunc = this.stageAnimations[index];
      this.currentApp?.ticker.remove(thisTickerFunc.animationObject.tickerFunc);
      if (thisTickerFunc.animationObject.forceStopWithoutSetEndState) {
        thisTickerFunc.animationObject.forceStopWithoutSetEndState();
      }
      this.unlockStageObject(thisTickerFunc.targetKey ?? 'default');
      this.stageAnimations.splice(index, 1);
    }
  }

  public removeAllAnimations() {
    while (this.stageAnimations.length > 0) {
      this.removeAnimationByIndex(0);
    }
  }

  public removeAnimation(key: string) {
    const index = this.stageAnimations.findIndex((e) => e.key === key);
    this.removeAnimationByIndex(index);
  }

  public removeAnimationByTargetKey(targetKey: string) {
    let index = this.stageAnimations.findIndex((e) => e.targetKey === targetKey);
    while (index !== -1) {
      this.removeAnimationByIndex(index);
      index = this.stageAnimations.findIndex((e) => e.targetKey === targetKey);
    }
  }

  public removeAnimationWithSetEffects(key: string) {
    const index = this.stageAnimations.findIndex((e) => e.key === key);
    if (index >= 0) {
      const thisTickerFunc = this.stageAnimations[index];
      this.currentApp?.ticker.remove(thisTickerFunc.animationObject.tickerFunc);
      thisTickerFunc.animationObject.setEndState();
      const endStateEffect = thisTickerFunc.animationObject.getEndStateEffect?.() ?? {};
      this.unlockStageObject(thisTickerFunc.targetKey ?? 'default');
      if (thisTickerFunc.targetKey) {
        const target = this.getStageObjByKey(thisTickerFunc.targetKey);
        if (target) {
          let effect: IEffect = {
            target: thisTickerFunc.targetKey,
            transform: endStateEffect,
          };
          webgalStore.dispatch(stageActions.updateEffect(effect));
          // if (!this.notUpdateBacklogEffects) updateCurrentBacklogEffects(webgalStore.getState().stage.effects);
        }
      }
      this.stageAnimations.splice(index, 1);
    }
  }

  // eslint-disable-next-line max-params
  public performMouthSyncAnimation(
    key: string,
    targetAnimation: IFigureAssociatedAnimation,
    mouthState: string,
    presetPosition: string,
  ) {
    const currentFigure = this.getStageObjByKey(key)?.pixiContainer as WebGALPixiContainer;

    if (!currentFigure) {
      return;
    }

    const mouthTextureUrls: any = {
      open: targetAnimation.mouthAnimation.open,
      half_open: targetAnimation.mouthAnimation.halfOpen,
      closed: targetAnimation.mouthAnimation.close,
    };

    // Load mouth texture (reuse if already loaded)
    this.loadAsset(mouthTextureUrls[mouthState], () => {
      const texture = this.assetLoader.resources[mouthTextureUrls[mouthState]].texture;
      const sprite = currentFigure?.children?.[0] as PIXI.Sprite;
      if (!texture || !sprite) {
        return;
      }
      sprite.texture = texture;
    });
  }

  // eslint-disable-next-line max-params
  public performBlinkAnimation(
    key: string,
    targetAnimation: IFigureAssociatedAnimation,
    blinkState: string,
    presetPosition: string,
  ) {
    const currentFigure = this.getStageObjByKey(key)?.pixiContainer as WebGALPixiContainer;

    if (!currentFigure) {
      return;
    }
    const blinkTextureUrls: any = {
      open: targetAnimation.blinkAnimation.open,
      closed: targetAnimation.blinkAnimation.close,
    };

    // Load eye texture (reuse if already loaded)
    this.loadAsset(blinkTextureUrls[blinkState], () => {
      const texture = this.assetLoader.resources[blinkTextureUrls[blinkState]].texture;
      const sprite = currentFigure?.children?.[0] as PIXI.Sprite;
      if (!texture || !sprite) {
        return;
      }
      sprite.texture = texture;
    });
  }

  /**
   * 添加背景
   * @param key 背景的标识，一般和背景类型有关
   * @param url 背景图片url
   */
  public addBg(key: string, url: string) {
    // const loader = this.assetLoader;
    const loader = this.assetLoader;
    // 准备用于存放这个背景的 Container
    const thisBgContainer = new WebGALPixiContainer();

    // 是否有相同 key 的背景
    const setBgIndex = this.backgroundObjects.findIndex((e) => e.key === key);
    const isBgSet = setBgIndex >= 0;

    // 已经有一个这个 key 的背景存在了
    if (isBgSet) {
      // 挤占
      this.removeStageObjectByKey(key);
    }

    // 挂载
    this.backgroundContainer.addChild(thisBgContainer);
    const bgUuid = uuid();
    this.backgroundObjects.push({
      uuid: bgUuid,
      key: key,
      pixiContainer: thisBgContainer,
      sourceUrl: url,
      sourceType: 'img',
      sourceExt: this.getExtName(url),
    });

    // 完成图片加载后执行的函数
    const setup = () => {
      // TODO：找一个更好的解法，现在的解法是无论是否复用原来的资源，都设置一个延时以让动画工作正常！

      setTimeout(() => {
        const texture = loader.resources?.[url]?.texture;
        if (texture && this.getStageObjByUuid(bgUuid)) {
          /**
           * 重设大小
           */
          const bgSprite = new PIXI.Sprite(texture);
          this.setContainerInitialPosition({
            container: thisBgContainer,
            childContainer: bgSprite,
            originalWidth: texture.width,
            originalHeight: texture.height,
            position: 'bg',
            isLive2DFigure: false,
          });
        }
      }, 0);
    };

    /**
     * 加载器部分
     */
    this.cacheGC();
    if (!loader.resources?.[url]?.texture) {
      this.loadAsset(url, setup);
    } else {
      // 复用
      setup();
    }
  }

  /**
   * 添加视频背景
   * @param key 背景的标识，一般和背景类型有关
   * @param url 背景图片url
   */
  public addVideoBg(key: string, url: string) {
    const loader = this.assetLoader;
    // 准备用于存放这个背景的 Container
    const thisBgContainer = new WebGALPixiContainer();

    // 是否有相同 key 的背景
    const setBgIndex = this.backgroundObjects.findIndex((e) => e.key === key);
    const isBgSet = setBgIndex >= 0;

    // 已经有一个这个 key 的背景存在了
    if (isBgSet) {
      // 挤占
      this.removeStageObjectByKey(key);
    }

    // 挂载
    this.backgroundContainer.addChild(thisBgContainer);
    const bgUuid = uuid();
    this.backgroundObjects.push({
      uuid: bgUuid,
      key: key,
      pixiContainer: thisBgContainer,
      sourceUrl: url,
      sourceType: 'video',
      sourceExt: this.getExtName(url),
    });

    // 完成加载后执行的函数
    const setup = () => {
      // TODO：找一个更好的解法，现在的解法是无论是否复用原来的资源，都设置一个延时以让动画工作正常！

      setTimeout(() => {
        console.debug('start loaded video: ' + url);
        const video = document.createElement('video');
        const videoResource = new PIXI.VideoResource(video);
        videoResource.src = url;
        videoResource.source.preload = 'auto';
        videoResource.source.muted = true;
        videoResource.source.loop = true;
        videoResource.source.autoplay = true;
        videoResource.source.src = url;
        // @ts-ignore
        const texture = PIXI.Texture.from(videoResource);
        if (texture && this.getStageObjByUuid(bgUuid)) {
          /**
           * 重设大小
           */
          texture.baseTexture.resource.load().then(() => {
            const bgSprite = new PIXI.Sprite(texture);
            this.setContainerInitialPosition({
              container: thisBgContainer,
              childContainer: bgSprite,
              originalWidth: videoResource.source.videoWidth,
              originalHeight: videoResource.source.videoHeight,
              position: 'bg',
              isLive2DFigure: false,
            });
          });
        }
      }, 0);
    };

    /**
     * 加载器部分
     */
    this.cacheGC();
    if (!loader.resources?.[url]?.texture) {
      this.loadAsset(url, setup);
    } else {
      // 复用
      setup();
    }
  }

  /**
   * 添加立绘
   * @param key 立绘的标识，一般和立绘位置有关
   * @param url 立绘图片url
   * @param presetPosition
   */
  public addFigure(key: string, url: string, presetPosition: 'left' | 'center' | 'right' = 'center') {
    const loader = this.assetLoader;
    // 准备用于存放这个立绘的 Container
    const thisFigureContainer = new WebGALPixiContainer();

    // 是否有相同 key 的立绘
    const setFigIndex = this.figureObjects.findIndex((e) => e.key === key);
    const isFigSet = setFigIndex >= 0;

    // 已经有一个这个 key 的立绘存在了
    if (isFigSet) {
      this.removeStageObjectByKey(key);
    }

    this.applyFigureMetadata(thisFigureContainer, key);

    // 挂载
    this.figureContainer.addChild(thisFigureContainer);
    const figureUuid = uuid();
    this.figureObjects.push({
      uuid: figureUuid,
      key: key,
      pixiContainer: thisFigureContainer,
      sourceUrl: url,
      sourceType: 'img',
      sourceExt: this.getExtName(url),
    });

    // 完成图片加载后执行的函数
    const setup = () => {
      // TODO：找一个更好的解法，现在的解法是无论是否复用原来的资源，都设置一个延时以让动画工作正常！
      setTimeout(() => {
        const texture = loader.resources?.[url]?.texture;
        if (texture && this.getStageObjByUuid(figureUuid)) {
          /**
           * 重设大小
           */
          const figureSprite = new PIXI.Sprite(texture);
          this.setContainerInitialPosition({
            container: thisFigureContainer,
            childContainer: figureSprite,
            originalWidth: texture.width,
            originalHeight: texture.height,
            position: presetPosition,
            isLive2DFigure: false,
          });
        }
      }, 0);
    };

    /**
     * 加载器部分
     */
    this.cacheGC();
    if (!loader.resources?.[url]?.texture) {
      this.loadAsset(url, setup);
    } else {
      // 复用
      setup();
    }
  }

  // 播放gif
  public async addGifFigure(key: string, url: string, presetPosition: 'left' | 'center' | 'right' = 'center') {
    const thisFigureContainer = new WebGALPixiContainer();

    // 移除已有相同 key 的立绘
    const existingIndex = this.figureObjects.findIndex((e) => e.key === key);
    if (existingIndex >= 0) {
      this.removeStageObjectByKey(key);
    }

    this.applyFigureMetadata(thisFigureContainer, key);

    // 添加容器到舞台
    this.figureContainer.addChild(thisFigureContainer);

    // 注册到立绘对象列表
    const figureUuid = uuid();
    this.figureObjects.push({
      uuid: figureUuid,
      key,
      pixiContainer: thisFigureContainer,
      sourceUrl: url,
      sourceType: 'gif',
      sourceExt: 'gif',
    });

    try {
      // ✅ 使用 fetch 异步加载 buffer
      const buffer = await fetch(url).then((res) => res.arrayBuffer());

      // ✅ 使用 AnimatedGIF.fromBuffer 异步解码
      const gif = await AnimatedGIF.fromBuffer(buffer);

      this.setContainerInitialPosition({
        container: thisFigureContainer,
        childContainer: gif,
        originalWidth: gif.width,
        originalHeight: gif.height,
        position: presetPosition,
        isLive2DFigure: false,
      });

      // ✅ 播放动画 + 添加到容器
      gif.play();
    } catch (e) {
      console.error('GIF 加载失败', e);
    }
  }
  // 聚合模型
  /* eslint-disable complexity */
  public async addJsonlFigure(key: string, jsonlPath: string, presetPosition: 'left' | 'center' | 'right' = 'center') {
    console.log('正在使用聚合模型');
    if (Live2D.isAvailable !== true) return;

    const container = new WebGALPixiContainer();
    const figureUuid = uuid();

    const index = this.figureObjects.findIndex((e) => e.key === key);
    if (index >= 0) {
      this.removeStageObjectByKey(key);
    }

    this.applyFigureMetadata(container, key);

    this.figureContainer.addChild(container);
    this.figureObjects.push({
      uuid: figureUuid,
      key,
      pixiContainer: container,
      sourceUrl: jsonlPath,
      sourceExt: 'jsonl',
      sourceType: 'live2d',
    });

    try {
      const response = await fetch(jsonlPath);
      const jsonlText = await response.text();
      const lines = jsonlText.split('\n').filter(Boolean);

      // const paths: string[] = [];
      const modelConfigs: {
        path: string;
        id?: string;
        x?: number;
        y?: number;
        xscale?: number;
        yscale?: number;
      }[] = [];
      let paramImport: number | null = null; // 用于存储 import 参数
      const jsonlBaseDir = jsonlPath.substring(0, jsonlPath.lastIndexOf('/') + 1);

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          // 解析 import 参数
          // ✅ 判断是否是最后一行的汇总参数（有 motions 或 expressions）
          if (obj?.motions || obj?.expressions) {
            if (obj?.import !== undefined) {
              paramImport = Number(obj.import);
              console.info('检测到汇总 import 参数:', paramImport);
            }
            continue; // ✨不要当作模型行处理！
          }
          if (obj?.path) {
            let fullPath = obj.path;
            if (!obj.path.startsWith('game/')) {
              fullPath = jsonlBaseDir + obj.path.replace(/^\.\//, '');
            }

            modelConfigs.push({
              path: fullPath,
              id: obj.id,
              x: obj.x,
              y: obj.y,
              xscale: obj.xscale,
              yscale: obj.yscale,
            });
          }
        } catch (e) {
          console.warn('JSONL parse error in line:', line);
        }
      }

      if (modelConfigs.length === 0) {
        console.warn('No valid paths in jsonl:', jsonlPath);
        return;
      }

      const currentMotionFromState = webgalStore.getState().stage.live2dMotion.find((e) => e.target === key);
      let overrideBounds: [number, number, number, number] = currentMotionFromState?.overrideBounds ?? [0, 0, 0, 0];

      const models: any[] = [];
      const loadModelResults = await Promise.allSettled(
        modelConfigs.map((config) => {
          return Live2D.Live2DModel.from(config.path, {
            autoInteract: false,
            overWriteBounds: {
              x0: overrideBounds[0],
              y0: overrideBounds[1],
              x1: overrideBounds[2],
              y1: overrideBounds[3],
            },
          });
        }),
      ).catch((e) => {
        console.error('addJsonlFigure 加载模型失败:', e);
      });

      if (!loadModelResults) return;

      for (let i = 0; i < loadModelResults.length; i++) {
        const result = loadModelResults[i];
        if (result.status !== 'fulfilled') {
          console.warn(`JSONL 第${i}个模型加载失败, 原因: ${result.reason}`);
          continue;
        }
        const { x, y, xscale, yscale } = modelConfigs[i];
        const modelPath = modelConfigs[i].path;
        const model = result.value;
        if (!model) continue;
        // 暂时隐藏模型，等全部模型加载后再统一显示
        model.visible = false;
        this.setContainerInitialPosition({
          container: container,
          childContainer: model,
          originalWidth: model.width,
          originalHeight: model.height,
          position: presetPosition,
          isLive2DFigure: true,
          overrideBounds: overrideBounds,
          transform: { xOffset: x, yOffset: y, xScale: xscale, yScale: yscale },
          isJsonlFigure: true,
        });
        models.push(model);

        // 每个模型加载完立刻设置 PARAM_IMPORT
        if (paramImport !== null) {
          try {
            model.internalModel?.coreModel?.setParamFloat?.('PARAM_IMPORT', paramImport);
            console.info(`✅ 设置 PARAM_IMPORT = ${paramImport} 给模型: ${modelPath}`);
          } catch (e) {
            console.warn(`❌ 设置 PARAM_IMPORT 失败 (${modelPath})`, e);
          }
        }
      }

      // 应用从状态中读取的 motion 和 expression
      const motionFromState = webgalStore.getState().stage.live2dMotion.find((e) => e.target === key);
      const expressionFromState = webgalStore.getState().stage.live2dExpression.find((e) => e.target === key);
      const blinkFromState = webgalStore.getState().stage.live2dBlink.find((e) => e.target === key);
      const focusFromState = webgalStore.getState().stage.live2dFocus.find((e) => e.target === key);
      const motionToSet = motionFromState?.motion ?? '';
      const expressionToSet = expressionFromState?.expression ?? '';
      const blinkToSet = { ...baseBlinkParam, ...(blinkFromState?.blink ?? {}) };
      const focusToSet = { ...baseFocusParam, ...(focusFromState?.focus ?? {}) };

      for (const model of models) {
        if (motionToSet) {
          // @ts-ignore
          model.motion(motionToSet, 0, 3);
        }
        if (expressionToSet) {
          // @ts-ignore
          model.expression(expressionToSet);
        }
        // 统一显示模型
        model.visible = true;
      }

      if (motionToSet) this.updateL2dMotionByKey(key, motionToSet);
      if (expressionToSet) this.updateL2dExpressionByKey(key, expressionToSet);
    } catch (e) {
      console.error('addJsonlFigure 加载失败:', e);
    }
  }
  /* eslint-disable complexity */
  // 添加视频模型
  public addVideoFigure(key: string, url: string, presetPosition: 'left' | 'center' | 'right' = 'center') {
    const thisFigureContainer = new WebGALPixiContainer();

    // 移除已有相同 key 的立绘
    const existingIndex = this.figureObjects.findIndex((e) => e.key === key);
    if (existingIndex >= 0) {
      this.removeStageObjectByKey(key);
    }

    this.applyFigureMetadata(thisFigureContainer, key);

    // 添加容器到舞台
    this.figureContainer.addChild(thisFigureContainer);

    // 注册到立绘对象列表
    const figureUuid = uuid();
    this.figureObjects.push({
      uuid: figureUuid,
      key,
      pixiContainer: thisFigureContainer,
      sourceUrl: url,
      sourceType: 'video',
      sourceExt: this.getExtName(url),
    });

    // 延迟一帧加载避免卡顿
    setTimeout(() => {
      const video = document.createElement('video');
      video.src = url;
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'auto';

      // 创建 PIXI texture
      const texture = PIXI.Texture.from(video);
      const sprite = new PIXI.Sprite(texture);

      // 加载后获取原始宽高
      video.onloadedmetadata = () => {
        this.setContainerInitialPosition({
          container: thisFigureContainer,
          childContainer: sprite,
          originalWidth: video.videoWidth,
          originalHeight: video.videoHeight,
          position: presetPosition,
          isLive2DFigure: false,
        });
      };

      // 错误处理
      video.onerror = (e) => {
        console.error('视频加载失败喵！', e);
      };
    }, 0);
  }

  /**
   * 添加 wmdl 立绘
   * @param key 立绘的标识，一般和立绘位置有关
   * @param url
   * @param presetPosition
   */
  // eslint-disable-next-line max-params
  public addWmdlFigure(key: string, url: string, presetPosition: 'left' | 'center' | 'right') {
    if (Live2D.isAvailable !== true) return;
    try {
      this.figureCash.push(url);

      const loader = this.assetLoader;
      // 准备用于存放这个立绘的 Container
      const thisFigureContainer = new WebGALPixiContainer();
      thisFigureContainer.sortableChildren = true;

      // 是否有相同 key 的立绘
      const setFigIndex = this.figureObjects.findIndex((e) => e.key === key);
      const isFigSet = setFigIndex >= 0;

      // 已经有一个这个 key 的立绘存在了
      if (isFigSet) {
        this.removeStageObjectByKey(key);
      }

      this.applyFigureMetadata(thisFigureContainer, key);
      // 挂载
      this.figureContainer.addChild(thisFigureContainer);
      const figureUuid = uuid();
      this.figureObjects.push({
        uuid: figureUuid,
        key: key,
        pixiContainer: thisFigureContainer,
        sourceUrl: url,
        sourceType: 'live2d',
        sourceExt: 'wmdl',
      });
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const instance = this;

      const setup = (stage: PixiStage) => {
        if (thisFigureContainer && this.getStageObjByUuid(figureUuid)) {
          (async function () {
            const response = await fetch(url);
            const dataText = await response.text();
            const wmdlConfig: {
              modelRelativePath?: string;
              subModels?: Array<{
                modelRelativePath?: string;
                offsetX?: number;
                offsetY?: number;
              }>;
            } = JSON.parse(dataText);

            // live2dBounds
            let overrideBounds: [number, number, number, number] = [0, 0, 0, 0];
            const mot = webgalStore.getState().stage.live2dMotion.find((e) => e.target === key);
            if (mot?.overrideBounds) {
              overrideBounds = mot.overrideBounds;
            }
            console.log(overrideBounds);

            let animation_index = 0;
            let priority_number = 3;

            // 整理主模型和子模型信息
            const modelInfos: Array<{
              modelRelativePath: string;
              offsetX: number;
              offsetY: number;
            }> = [];
            if (wmdlConfig.modelRelativePath) {
              modelInfos.push({
                modelRelativePath: wmdlConfig.modelRelativePath,
                offsetX: 0,
                offsetY: 0,
              });
            }
            if (wmdlConfig.subModels) {
              wmdlConfig.subModels.forEach((subModel) => {
                if (subModel.modelRelativePath) {
                  modelInfos.push({
                    modelRelativePath: subModel.modelRelativePath,
                    offsetX: subModel.offsetX ?? 0,
                    offsetY: subModel.offsetY ?? 0,
                  });
                }
              });
            }

            const models: any[] = [];
            const wmdlBaseDir = url.substring(0, url.lastIndexOf('/') + 1);

            const loadResult = await Promise.allSettled(
              modelInfos.map((modelInfo) =>
                Live2D.Live2DModel.from(wmdlBaseDir + modelInfo.modelRelativePath, {
                  autoInteract: false,
                  overWriteBounds: {
                    x0: overrideBounds[0],
                    y0: overrideBounds[1],
                    x1: overrideBounds[2],
                    y1: overrideBounds[3],
                  },
                }),
              ),
            ).catch((err) => {
              console.error(`WMDL 模型加载失败: ${err}`);
            });

            if (!loadResult) return;

            for (let i = 0; i < loadResult.length; i++) {
              const result = loadResult[i];
              if (result.status !== 'fulfilled') {
                console.warn(`WMDL 第${i}个模型加载失败, 原因: ${result.reason}`);
                continue;
              }
              const modelInfo = modelInfos[i];
              const model = result.value;
              model.zIndex = i;
              stage.setContainerInitialPosition({
                container: thisFigureContainer,
                childContainer: model,
                originalWidth: model.width,
                originalHeight: model.height,
                position: presetPosition,
                isLive2DFigure: true,
                overrideBounds: overrideBounds,
                transform: {
                  xOffset: modelInfo.offsetX,
                  yOffset: modelInfo.offsetY,
                },
              });

              // 监听模型更新事件，确保口型参数不被motion覆盖
              // @ts-ignore
              model.internalModel.on('beforeModelUpdate', () => {
                // 获取当前的口型值并重新应用
                const currentMouthValue = instance.getCurrentMouthValue(key);
                if (currentMouthValue !== null) {
                  instance.setModelMouthY(key, currentMouthValue);
                }
              });

              model.visible = false; // 先隐藏，等全部模型加载完再显示
              models.push(model);
            }

            // motion
            let motionToSet = '';
            const motionFromState = webgalStore.getState().stage.live2dMotion.find((e) => e.target === key);
            if (motionFromState) {
              motionToSet = motionFromState.motion;
            }
            instance.updateL2dMotionByKey(key, motionToSet);

            // expression
            let expressionToSet = '';
            const expressionFromState = webgalStore.getState().stage.live2dExpression.find((e) => e.target === key);
            if (expressionFromState) {
              expressionToSet = expressionFromState.expression;
            }
            instance.updateL2dExpressionByKey(key, expressionToSet);

            // blink
            let blinkToSet: BlinkParam = baseBlinkParam;
            const blinkFromState = webgalStore.getState().stage.live2dBlink.find((e) => e.target === key);
            if (blinkFromState) {
              blinkToSet = { ...blinkToSet, ...blinkFromState.blink };
            }
            instance.updateL2dBlinkByKey(key, blinkToSet);

            // focus
            let focusToSet: FocusParam = baseFocusParam;
            const focusFromState = webgalStore.getState().stage.live2dFocus.find((e) => e.target === key);
            if (focusFromState) {
              focusToSet = { ...focusToSet, ...focusFromState.focus };
            }
            instance.updateL2dFocusByKey(key, focusToSet);

            // 全部模型加载完毕，显示它们
            models.forEach((model) => {
              model.visible = true;
              model.motion(motionToSet, animation_index, priority_number);
              model.expression(expressionToSet);
              model.internalModel?.setBlinkParam(blinkToSet);
              model.internalModel?.focusController?.focus(focusToSet.x, focusToSet.y, focusToSet.instant);
            });
            // lip-sync is still a problem and you can not.
            Live2D.SoundManager.volume = 0; // @ts-ignore
          })();
        }
      };

      /**
       * 加载器部分
       */
      const resourses = Object.keys(loader.resources);
      this.cacheGC();
      if (!resourses.includes(url)) {
        this.loadAsset(url, () => setup(this));
      } else {
        // 复用
        setup(this);
      }
    } catch (error) {
      console.error('Live2d Module err: ' + error);
      Live2D.isAvailable = false;
    }
  }

  /**
   * Live2d立绘，如果要使用 Live2D，取消这里的注释
   * @param jsonPath
   */
  // eslint-disable-next-line max-params
  public addLive2dFigure(key: string, jsonPath: string, pos: 'left' | 'center' | 'right') {
    if (Live2D.isAvailable !== true) return;
    try {
      let stageWidth = this.stageWidth;
      let stageHeight = this.stageHeight;

      this.figureCash.push(jsonPath);

      const loader = this.assetLoader;
      // 准备用于存放这个立绘的 Container
      const thisFigureContainer = new WebGALPixiContainer();

      // 是否有相同 key 的立绘
      const setFigIndex = this.figureObjects.findIndex((e) => e.key === key);
      const isFigSet = setFigIndex >= 0;

      // 已经有一个这个 key 的立绘存在了
      if (isFigSet) {
        this.removeStageObjectByKey(key);
      }

      this.applyFigureMetadata(thisFigureContainer, key);
      // 挂载
      this.figureContainer.addChild(thisFigureContainer);
      const figureUuid = uuid();
      this.figureObjects.push({
        uuid: figureUuid,
        key: key,
        pixiContainer: thisFigureContainer,
        sourceUrl: jsonPath,
        sourceType: 'live2d',
        sourceExt: 'json',
      });
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const instance = this;

      const setup = (stage: PixiStage) => {
        if (thisFigureContainer && this.getStageObjByUuid(figureUuid)) {
          (async function () {
            let overrideBounds: [number, number, number, number] = [0, 0, 0, 0];
            const mot = webgalStore.getState().stage.live2dMotion.find((e) => e.target === key);
            if (mot?.overrideBounds) {
              overrideBounds = mot.overrideBounds;
            }
            console.log(overrideBounds);
            const models = await Promise.all([
              Live2D.Live2DModel.from(jsonPath, {
                autoInteract: false,
                overWriteBounds: {
                  x0: overrideBounds[0],
                  y0: overrideBounds[1],
                  x1: overrideBounds[2],
                  y1: overrideBounds[3],
                },
              }),
            ]);

            models.forEach((model) => {
              stage.setContainerInitialPosition({
                container: thisFigureContainer,
                childContainer: model,
                originalWidth: model.width,
                originalHeight: model.height,
                position: pos,
                isLive2DFigure: true,
                overrideBounds: overrideBounds,
              });

              let animation_index = 0;
              let priority_number = 3;

              // motion
              let motionToSet = '';
              const motionFromState = webgalStore.getState().stage.live2dMotion.find((e) => e.target === key);
              if (motionFromState) {
                motionToSet = motionFromState.motion;
              }
              instance.updateL2dMotionByKey(key, motionToSet);
              model.motion(motionToSet, animation_index, priority_number);

              // expression
              let expressionToSet = '';
              const expressionFromState = webgalStore.getState().stage.live2dExpression.find((e) => e.target === key);
              if (expressionFromState) {
                expressionToSet = expressionFromState.expression;
              }
              instance.updateL2dExpressionByKey(key, expressionToSet);
              model.expression(expressionToSet);

              // blink
              let blinkToSet: BlinkParam = baseBlinkParam;
              const blinkFromState = webgalStore.getState().stage.live2dBlink.find((e) => e.target === key);
              if (blinkFromState) {
                blinkToSet = { ...blinkToSet, ...blinkFromState.blink };
              }
              instance.updateL2dBlinkByKey(key, blinkToSet);
              model.internalModel?.setBlinkParam(blinkToSet);

              // focus
              let focusToSet: FocusParam = baseFocusParam;
              const focusFromState = webgalStore.getState().stage.live2dFocus.find((e) => e.target === key);
              if (focusFromState) {
                focusToSet = { ...focusToSet, ...focusFromState.focus };
              }
              instance.updateL2dFocusByKey(key, focusToSet);
              model.internalModel?.focusController?.focus(focusToSet.x, focusToSet.y, focusToSet.instant);

              // lip-sync is still a problem and you can not.
              Live2D.SoundManager.volume = 0; // @ts-ignore

              // 监听模型更新事件，确保口型参数不被motion覆盖
              // @ts-ignore
              model.internalModel.on('beforeModelUpdate', () => {
                // 获取当前的口型值并重新应用
                const currentMouthValue = instance.getCurrentMouthValue(key);
                if (currentMouthValue !== null) {
                  instance.setModelMouthY(key, currentMouthValue);
                }
              });
            });
          })();
        }
      };

      /**
       * 加载器部分
       */
      const resourses = Object.keys(loader.resources);
      this.cacheGC();
      if (!resourses.includes(jsonPath)) {
        this.loadAsset(jsonPath, () => setup(this));
      } else {
        // 复用
        setup(this);
      }
    } catch (error) {
      console.error('Live2d Module err: ' + error);
      Live2D.isAvailable = false;
    }
  }

  public changeModelMotionByKey(key: string, motion: string) {
    // logger.debug(`Applying motion ${motion} to ${key}`);
    const target = this.figureObjects.find((e) => e.key === key && !e.isExiting);
    if (target?.sourceType === 'live2d') {
      const figureRecordTarget = this.live2dFigureRecorder.find((e) => e.target === key);
      if (target && figureRecordTarget?.motion !== motion) {
        const container = target.pixiContainer;
        if (!container) return;
        const children = container.children;
        for (const model of children) {
          let category_name = motion;
          let animation_index = 0;
          let priority_number = 3; // @ts-ignore
          const internalModel = model?.internalModel ?? undefined; // 安全访问
          internalModel?.motionManager?.stopAllMotions?.();
          // @ts-ignore
          model.motion(category_name, animation_index, priority_number);
        }
        this.updateL2dMotionByKey(key, motion);
      }
    } else if (target?.sourceType === 'spine') {
      // 处理 Spine 动画切换
      this.changeSpineAnimationByKey(key, motion);
    }
  }

  public changeSpineAnimationByKey(key: string, animation: string) {
    const target = this.figureObjects.find((e) => e.key === key && !e.isExiting);
    if (target?.sourceType !== 'spine') return;

    const container = target.pixiContainer;
    if (!container) return;
    // Spine figure 结构: Container -> Sprite -> Spine
    const sprite = container.children[0] as PIXI.Container;
    if (sprite?.children?.[0]) {
      const spineObject = sprite.children[0];
      // @ts-ignore
      if (spineObject.state && spineObject.spineData) {
        // @ts-ignore
        const animationExists = spineObject.spineData.animations.find((anim: any) => anim.name === animation);
        let targetCurrentAnimation = target?.spineAnimation ?? '';
        if (animationExists && targetCurrentAnimation !== animation) {
          console.log(`setting animation ${animation}`);
          target!.spineAnimation = animation;
          // @ts-ignore
          spineObject.state.setAnimation(0, animation, false);
        }
      }
    }
  }

  public changeSpineSkinByKey(key: string, skin: string) {
    if (!skin) return;

    const target = this.figureObjects.find((e) => e.key === key && !e.isExiting);
    if (target?.sourceType !== 'spine') return;

    const container = target.pixiContainer;
    if (!container) return;
    const sprite = container.children[0] as PIXI.Container;
    if (sprite?.children?.[0]) {
      const spineObject = sprite.children[0];
      // @ts-ignore
      const skeleton = spineObject.skeleton;
      // @ts-ignore
      const skeletonData = skeleton?.data ?? spineObject.spineData;
      const skinObject =
        // @ts-ignore
        skeletonData?.findSkin?.(skin) ??
        // @ts-ignore
        skeletonData?.skins?.find((item: any) => item.name === skin);

      if (!skeleton || !skinObject) {
        logger.warn(`Spine skin not found: ${skin} on ${key}`);
        return;
      }

      try {
        // @ts-ignore
        if (typeof skeleton.setSkinByName === 'function') {
          // @ts-ignore
          skeleton.setSkinByName(skin);
        } else {
          // @ts-ignore
          skeleton.setSkin(skinObject);
        }
      } catch (error) {
        // @ts-ignore
        skeleton.setSkin?.(skinObject);
      }

      // @ts-ignore
      if (typeof skeleton.setSlotsToSetupPose === 'function') {
        // @ts-ignore
        skeleton.setSlotsToSetupPose();
      } else {
        // @ts-ignore
        skeleton.setupPoseSlots?.();
      }

      // @ts-ignore
      spineObject.state?.apply?.(skeleton);
      // @ts-ignore
      skeleton.updateWorldTransform?.();
    }
  }

  public changeModelExpressionByKey(key: string, expression: string) {
    // logger.debug(`Applying expression ${expression} to ${key}`);
    const target = this.figureObjects.find((e) => e.key === key && !e.isExiting);
    if (target?.sourceType !== 'live2d') return;
    const figureRecordTarget = this.live2dFigureRecorder.find((e) => e.target === key);
    if (target && figureRecordTarget?.expression !== expression) {
      const container = target.pixiContainer;
      if (!container) return;
      const children = container.children;
      for (const model of children) {
        // @ts-ignore
        model.expression(expression);
      }
      this.updateL2dExpressionByKey(key, expression);
    }
  }

  public changeModelBlinkByKey(key: string, blinkParam: BlinkParam) {
    const target = this.figureObjects.find((e) => e.key === key && !e.isExiting);
    if (target?.sourceType !== 'live2d') return;
    const figureRecordTarget = this.live2dFigureRecorder.find((e) => e.target === key);
    if (target && !isEqual(figureRecordTarget?.blink, blinkParam)) {
      const container = target.pixiContainer;
      if (!container) return;
      const children = container.children;
      let newBlinkParam: BlinkParam = { ...baseBlinkParam, ...blinkParam };
      // 继承现有 BlinkParam
      if (figureRecordTarget?.blink) {
        newBlinkParam = { ...cloneDeep(figureRecordTarget.blink), ...blinkParam };
      }
      for (const model of children) {
        // @ts-ignore
        model?.internalModel?.setBlinkParam?.(newBlinkParam);
      }
      this.updateL2dBlinkByKey(key, newBlinkParam);
    }
  }

  public changeModelFocusByKey(key: string, focusParam: FocusParam) {
    const target = this.figureObjects.find((e) => e.key === key && !e.isExiting);
    if (target?.sourceType !== 'live2d') return;
    const figureRecordTarget = this.live2dFigureRecorder.find((e) => e.target === key);
    if (target && !isEqual(figureRecordTarget?.focus, focusParam)) {
      const container = target.pixiContainer;
      if (!container) return;
      const children = container.children;
      let newFocusParam: FocusParam = { ...baseFocusParam, ...focusParam };
      // 继承现有 FocusParam
      if (figureRecordTarget?.focus) {
        newFocusParam = { ...cloneDeep(figureRecordTarget.focus), ...focusParam };
      }
      for (const model of children) {
        // @ts-ignore
        model?.internalModel?.focusController.focus(newFocusParam.x, newFocusParam.y, newFocusParam.instant);
      }
      this.updateL2dFocusByKey(key, newFocusParam);
    }
  }

  public setModelMouthY(key: string, y: number) {
    function mapToZeroOne(value: number) {
      return value < 50 ? 0 : (value - 50) / 50;
    }

    const paramY = mapToZeroOne(y);
    const target = this.figureObjects.find((e) => e.key === key);
    if (target && target.sourceType === 'live2d') {
      const container = target.pixiContainer;
      if (!container) return;
      const children = container.children;
      for (const model of children) {
        // @ts-ignore
        if (model?.internalModel) {
          // @ts-ignore
          if (model?.internalModel?.coreModel?.setParamFloat)
            // @ts-ignore
            model?.internalModel?.coreModel?.setParamFloat?.('PARAM_MOUTH_OPEN_Y', paramY);
          // @ts-ignore
          if (model?.internalModel?.coreModel?.setParameterValueById)
            // @ts-ignore
            model?.internalModel?.coreModel?.setParameterValueById('ParamMouthOpenY', paramY);
        }
      }
    } // 存储当前口型值
    this.currentMouthValues.set(key, y);
  }

  /**
   * 获取当前口型值
   * @param key 角色key
   * @returns 口型值，如果没有则返回null
   */
  public getCurrentMouthValue(key: string): number | null {
    return this.currentMouthValues.get(key) ?? null;
  }

  /**
   * 根据 key 获取舞台上的对象
   * @param key
   */
  public getStageObjByKey(key: string) {
    return [...this.figureObjects, ...this.backgroundObjects, this.mainStageObject].find((e) => e.key === key);
  }

  public getStageObjByUuid(objUuid: string) {
    return [...this.figureObjects, ...this.backgroundObjects, this.mainStageObject].find((e) => e.uuid === objUuid);
  }

  public getAllStageObj() {
    return [...this.figureObjects, ...this.backgroundObjects, this.mainStageObject];
  }

  /**
   * 根据 key 删除舞台上的对象
   * @param key
   */
  public removeStageObjectByKey(key: string) {
    const indexFig = this.figureObjects.findIndex((e) => e.key === key);
    const indexBg = this.backgroundObjects.findIndex((e) => e.key === key);
    if (indexFig >= 0) {
      const bgSprite = this.figureObjects[indexFig];
      if (bgSprite.pixiContainer)
        for (const element of bgSprite.pixiContainer.children) {
          element.destroy();
        }
      if (bgSprite.pixiContainer) {
        bgSprite.pixiContainer.destroy();
        this.figureContainer.removeChild(bgSprite.pixiContainer);
      }
      bgSprite.pixiContainer = null;
      this.figureObjects.splice(indexFig, 1);
    }
    if (indexBg >= 0) {
      const bgSprite = this.backgroundObjects[indexBg];
      if (bgSprite.pixiContainer)
        for (const element of bgSprite.pixiContainer.children) {
          element.destroy();
        }
      if (bgSprite.pixiContainer) {
        bgSprite.pixiContainer.destroy();
        this.backgroundContainer.removeChild(bgSprite.pixiContainer);
      }
      bgSprite.pixiContainer = null;
      this.backgroundObjects.splice(indexBg, 1);
    }
    // /**
    //  * 删掉相关 Effects，因为已经移除了
    //  */
    // const prevEffects = webgalStore.getState().stage.effects;
    // const newEffects = __.cloneDeep(prevEffects);
    // const index = newEffects.findIndex((e) => e.target === key);
    // if (index >= 0) {
    //   newEffects.splice(index, 1);
    // }
    // updateCurrentEffects(newEffects);
  }

  public cacheGC() {
    PIXI.utils.clearTextureCache();
  }

  public getExtName(url: string) {
    return url.split('.').pop() ?? 'png';
  }

  public getFigureMetadataByKey(key: string): IFigureMetadata | undefined {
    return webgalStore.getState().stage.figureMetaData[key];
  }

  public loadAsset(url: string, callback: () => void, name?: string) {
    /**
     * Loader 复用疑似有问题，转而采用先前的单独方式
     */
    this.loadQueue.unshift({ url, callback, name });
    /**
     * 尝试启动加载
     */
    this.callLoader();
  }

  private updateL2dMotionByKey(target: string, motion: string) {
    const figureTargetIndex = this.live2dFigureRecorder.findIndex((e) => e.target === target);
    if (figureTargetIndex >= 0) {
      this.live2dFigureRecorder[figureTargetIndex].motion = motion;
    } else {
      this.live2dFigureRecorder.push({ target, motion, expression: '', blink: baseBlinkParam, focus: baseFocusParam });
    }
  }

  private updateL2dExpressionByKey(target: string, expression: string) {
    const figureTargetIndex = this.live2dFigureRecorder.findIndex((e) => e.target === target);
    if (figureTargetIndex >= 0) {
      this.live2dFigureRecorder[figureTargetIndex].expression = expression;
    } else {
      this.live2dFigureRecorder.push({ target, motion: '', expression, blink: baseBlinkParam, focus: baseFocusParam });
    }
  }

  private updateL2dBlinkByKey(target: string, blink: BlinkParam) {
    const figureTargetIndex = this.live2dFigureRecorder.findIndex((e) => e.target === target);
    if (figureTargetIndex >= 0) {
      this.live2dFigureRecorder[figureTargetIndex].blink = blink;
    } else {
      this.live2dFigureRecorder.push({ target, motion: '', expression: '', blink, focus: baseFocusParam });
    }
  }

  private updateL2dFocusByKey(target: string, focus: FocusParam) {
    const figureTargetIndex = this.live2dFigureRecorder.findIndex((e) => e.target === target);
    if (figureTargetIndex >= 0) {
      this.live2dFigureRecorder[figureTargetIndex].focus = focus;
    } else {
      this.live2dFigureRecorder.push({ target, motion: '', expression: '', blink: baseBlinkParam, focus });
    }
  }

  private callLoader() {
    if (!this.assetLoader.loading) {
      const front = this.loadQueue.shift();
      if (front) {
        try {
          if (this.assetLoader.resources[front.url]) {
            front.callback();
            this.callLoader();
          } else {
            if (front.name) {
              this.assetLoader.add(front.name, front.url).load(() => {
                front.callback();
                this.callLoader();
              });
            } else {
              this.assetLoader.add(front.url).load(() => {
                front.callback();
                this.callLoader();
              });
            }
          }
        } catch (error) {
          logger.fatal('PIXI Loader 故障', error);
          front.callback();
          // this.assetLoader.reset(); // 暂时先不用重置
          this.callLoader();
        }
      }
    }
  }

  private updateFps() {
    getScreenFps?.(120).then((fps) => {
      this.frameDuration = 1000 / (fps as number);
      // logger.info('当前帧率', fps);
    });
  }

  private lockStageObject(targetName: string) {
    this.lockTransformTarget.push(targetName);
  }

  private unlockStageObject(targetName: string) {
    const index = this.lockTransformTarget.findIndex((name) => name === targetName);
    if (index >= 0) this.lockTransformTarget.splice(index, 1);
  }

  /**
   * 应用立绘元数据
   */
  private applyFigureMetadata(container: WebGALPixiContainer, key: string) {
    const metadata = this.getFigureMetadataByKey(key);
    if (metadata === undefined) return;

    if (metadata?.blendMode !== undefined) {
      container.blendMode = metadata.blendMode;
    }
    if (metadata?.zIndex !== undefined) {
      container.zIndex = metadata.zIndex;
    }
  }

  /**
   * 设置容器的初始定位
   */
  private setContainerInitialPosition(options: SetContainerInitialPositionOptions) {
    const {
      container,
      childContainer,
      originalWidth,
      originalHeight,
      position,
      isLive2DFigure,
      overrideBounds = [0, 0, 0, 0],
      transform: { xOffset = 0, yOffset = 0, xScale = 1, yScale = 1 } = {
        xOffset: 0,
        yOffset: 0,
        xScale: 1,
        yScale: 1,
      },
      isJsonlFigure,
    } = options;

    try {
      let positioningType = Live2D.positioningType;
      // 非 Live2D 立绘一律使用 4.5.13 定位 ('M_2_4')
      if (!isLive2DFigure) {
        positioningType = 'M_2_4';
      }
      // JSONL 立绘在 MyGO 3.0.0 仍然使用 4.5.13 定位
      if (isJsonlFigure && positioningType === 'M_3_0_0') {
        positioningType = 'M_2_4';
      }

      const scaleX = this.stageWidth / originalWidth;
      const scaleY = this.stageHeight / originalHeight;
      // 背景使用覆盖式缩放，立绘使用适应式缩放
      let targetScale = 1.0;
      if (position === 'bg') {
        targetScale = Math.max(scaleX, scaleY);
      } else {
        targetScale = Math.min(scaleX, scaleY);
        switch (positioningType) {
          case 'M_2_3':
            targetScale *= 1.5;
            break;
          case 'M_3_0_0':
          case 'M_3_1_0':
            targetScale *= 1.25;
            break;
        }
      }

      childContainer.scale.set(targetScale * xScale, targetScale * yScale);
      childContainer.anchor.set(0.5);
      childContainer.pivot.x += (overrideBounds[0] + overrideBounds[2]) * 0.5;
      childContainer.pivot.y += (overrideBounds[1] + overrideBounds[3]) * 0.5;

      switch (positioningType) {
        case 'M_2_3':
          childContainer.position.x = this.stageWidth / 2 + xOffset;
          childContainer.position.y = this.stageHeight / 1.2 + yOffset;
          break;
        case 'M_3_0_0':
        case 'M_3_1_0':
          childContainer.position.x = xOffset;
          childContainer.position.y = this.stageHeight / 1.8 + yOffset;
          break;
        default:
          childContainer.position.x = xOffset;
          childContainer.position.y = this.stageHeight / 2 + yOffset;
          break;
      }

      if (position === 'bg') {
        container.setBaseX(this.stageWidth / 2);
        container.setBaseY(this.stageHeight / 2);
      } else {
        const targetWidth = originalWidth * targetScale;
        const targetHeight = originalHeight * targetScale;
        // 立绘尽量贴底
        switch (positioningType) {
          case 'M_2_3':
            break;
          default:
            if (targetHeight < this.stageHeight) {
              container.setBaseY(this.stageHeight / 2 + (this.stageHeight - targetHeight) / 2);
            } else {
              container.setBaseY(this.stageHeight / 2);
            }
            break;
        }
        // 立绘左中右
        if (position === 'center') {
          switch (positioningType) {
            case 'M_2_3':
              break;
            default:
              container.setBaseX(this.stageWidth / 2);
              break;
          }
        }
        if (position === 'left') {
          switch (positioningType) {
            case 'M_3_0_0':
            case 'M_3_1_0':
              container.setBaseX(this.stageWidth / 2 - 430);
              break;
            default:
              container.setBaseX(targetWidth / 2);
              break;
          }
        }
        if (position === 'right') {
          switch (positioningType) {
            case 'M_3_0_0':
            case 'M_3_1_0':
              container.setBaseX(this.stageWidth / 2 + 430);
              break;
            default:
              container.setBaseX(this.stageWidth - targetWidth / 2);
              break;
          }
        }
      }

      switch (positioningType) {
        case 'M_2_3':
          break;
        default:
          container.pivot.set(0, this.stageHeight / 2);
          break;
      }
      container.addChild(childContainer);
    } catch (error) {
      console.error('设置容器初始位置失败:', error);
    }
  }

  private async initialize() {
    // 动态加载 figureCash
    try {
      const { figureCash } = await import('@/Core/gameScripts/vocal/conentsCash');
      this.figureCash = figureCash;
    } catch (error) {
      console.error('Failed to load figureCash:', error);
    }
  }
}

function updateCurrentBacklogEffects(newEffects: IEffect[]) {
  /**
   * 更新当前 backlog 条目的 effects 记录
   */
  setTimeout(() => {
    WebGAL.backlogManager.editLastBacklogItemEffect(cloneDeep(newEffects));
  }, 50);

  webgalStore.dispatch(setStage({ key: 'effects', value: newEffects }));
}

/**
 * @param {number} targetCount 不小于1的整数，表示经过targetCount帧之后返回结果
 * @return {Promise<number>}
 */
const getScreenFps = (() => {
  // 先做一下兼容性处理
  const nextFrame = [
    window.requestAnimationFrame,
    // @ts-ignore
    window.webkitRequestAnimationFrame,
    // @ts-ignore
    window.mozRequestAnimationFrame,
  ].find((fn) => fn);
  if (!nextFrame) {
    console.error('requestAnimationFrame is not supported!');
    return;
  }
  return (targetCount = 60) => {
    // 判断参数是否合规
    if (targetCount < 1) throw new Error('targetCount cannot be less than 1.');
    const beginDate = Date.now();
    let count = 0;
    return new Promise((resolve) => {
      (function log() {
        nextFrame(() => {
          if (++count >= targetCount) {
            const diffDate = Date.now() - beginDate;
            const fps = (count / diffDate) * 1000;
            return resolve(fps);
          }
          log();
        });
      })();
    });
  };
})();
