import React from 'react';
import { switchAuto } from '@/Core/controller/gamePlay/autoPlay';
import { backToTitle } from '@/Core/controller/gamePlay/backToTitle';
import { switchFast } from '@/Core/controller/gamePlay/fastSkip';
import { loadGame } from '@/Core/controller/storage/loadGame';
import { saveGame } from '@/Core/controller/storage/saveGame';
import { showGlogalDialog, switchControls } from '@/UI/GlobalDialog/GlobalDialog';
import { easyCompile } from '@/UI/Menu/SaveAndLoad/Save/Save';
import useFullScreen from '@/hooks/useFullScreen';
import useSoundEffect from '@/hooks/useSoundEffect';
import useTrans from '@/hooks/useTrans';
import { setMenuPanelTag, setVisibility } from '@/store/GUIReducer';
import { componentsVisibility, MenuPanelTag } from '@/store/guiInterface';
import { RootState } from '@/store/store';
import {
  AlignTextLeftOne,
  DoubleDown,
  DoubleRight,
  DoubleUp,
  FolderOpen,
  FullScreen,
  Home,
  Lock,
  OffScreen,
  PlayOne,
  PreviewCloseOne,
  PreviewOpen,
  ReplayMusic,
  Save,
  SettingTwo,
  Unlock,
  LeftTwo,
  RightTwo,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import styles from './bangBottomControlPanel.module.scss';
import { useValue } from '@/hooks/useValue';
import { BangBottom } from './BangBottom';
import { FC, ReactNode } from 'react';
import { WebGAL } from '@/Core/WebGAL';
import { config } from '@/config/mygo';
import { __INFO } from '@/config/info';

export function BangBottomControlPanel() {
  const t = useTrans('gaming.');
  const strokeWidth = 2.5;
  const { i18n } = useTranslation();
  const { playSeDialogOpen } = useSoundEffect();
  const lang = i18n.language;
  const isFr = lang === 'fr';
  let size = 42;
  let fontSize = '150%';
  if (isFr) {
    fontSize = '125%';
    size = 40;
  }
  const { isSupported: isFullscreenSupport, isFullScreen, toggle: toggleFullscreen } = useFullScreen();
  const GUIStore = useSelector((state: RootState) => state.GUI);
  const stageState = useSelector((state: RootState) => state.stage);
  const userData = useSelector((state: RootState) => state.userData);
  const dispatch = useDispatch();
  const setComponentVisibility = (component: keyof componentsVisibility, visibility: boolean) => {
    dispatch(setVisibility({ component, visibility }));
  };
  const setMenuPanel = (menuPanel: MenuPanelTag) => {
    dispatch(setMenuPanelTag(menuPanel));
  };

  const saveData = useSelector((state: RootState) => state.saveData.saveData);
  let fastSlPreview = (
    <div style={{ height: '100%', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ fontSize: '125%' }}>{t('noSaving')}</div>
    </div>
  );
  if (saveData[0]) {
    const data = saveData[0];
    fastSlPreview = (
      <div className={styles.slPreviewMain}>
        <div className={styles.imgContainer}>
          <img style={{ height: '100%' }} alt="q-save-preview image" src={data.previewImage} />
        </div>
        <div className={styles.textContainer}>
          <div>{easyCompile(data.nowStageState.showName)}</div>
          <div style={{ fontSize: '75%', color: 'rgb(55,60,56)' }}>{easyCompile(data.nowStageState.showText)}</div>
        </div>
      </div>
    );
  }

  const handleWheel = (ev: React.WheelEvent<HTMLDivElement>) => {
    ev.stopPropagation();
    ev.preventDefault();
    const target = ev.currentTarget;
    target.scrollLeft += ev.deltaY;
  };

  const isFolded = useValue(true);

  return GUIStore.showTextBox && userData.optionData.enableBangControlPanel && stageState.enableFilm === '' ? (
    <div
      className={styles.main}
      style={{
        visibility: GUIStore.controlsVisibility ? 'visible' : 'hidden',
        width: isFolded.value ? '320px' : '2020px',
      }}
    >
      <div className={styles.background}>
        <div
          className={styles.foldButton}
          onClick={() => {
            isFolded.value = !isFolded.value;
          }}
        >
          <div className={styles.icon}>
            <LeftTwo theme="filled" size={64} style={{ display: isFolded.value ? 'inline' : 'none' }} />
            <RightTwo theme="filled" size={64} style={{ display: isFolded.value ? 'none' : 'inline' }} />
          </div>
          <div className={styles.text}>菜单</div>
        </div>
        <div
          className={styles.buttons}
          style={{ display: isFolded.value ? 'none' : 'flex' }}
          data-control-panel="bottom"
          onWheel={handleWheel}
        >
          <PanelButton
            icon={<Home />}
            text={t('buttons.title')}
            onClick={() => {
              playSeDialogOpen();
              showGlogalDialog({
                title: t('buttons.titleTips'),
                leftText: t('$common.yes'),
                rightText: t('$common.no'),
                leftFunc: () => {
                  backToTitle();
                },
                rightFunc: () => {},
              });
            }}
          />
          <PanelButton
            icon={<SettingTwo />}
            text={t('buttons.options')}
            onClick={() => {
              setMenuPanel(MenuPanelTag.Option);
              setComponentVisibility('showMenuPanel', true);
            }}
          />
          <PanelButton
            icon={<PlayOne />}
            text={t('buttons.auto')}
            onClick={() => {
              switchAuto();
            }}
            isActive={WebGAL.gameplay.isAuto}
          />
          {isFullscreenSupport && (
            <PanelButton
              icon={isFullScreen ? <OffScreen /> : <FullScreen />}
              text={t('buttons.fullscreen')}
              onClick={toggleFullscreen}
            />
          )}
          <PanelButton
            icon={<DoubleRight />}
            text={t('buttons.forward')}
            onClick={() => {
              switchFast();
            }}
            isActive={WebGAL.gameplay.isFast}
          />
          <PanelButton
            icon={<ReplayMusic />}
            text={t('buttons.replay')}
            onClick={() => {
              let VocalControl: any = document.getElementById('currentVocal');
              if (VocalControl !== null) {
                VocalControl.currentTime = 0;
                VocalControl.pause();
                VocalControl?.play();
              }
            }}
          />
          <PanelButton
            icon={<AlignTextLeftOne />}
            text={t('buttons.backlog')}
            onClick={() => {
              setComponentVisibility('showBacklog', true);
              setComponentVisibility('showTextBox', false);
            }}
          />
          <PanelButton
            icon={<DoubleDown />}
            text={t('buttons.quicklySave')}
            onClick={() => {
              saveGame(0);
            }}
            small={true}
            className={styles.fastSave}
          >
            <div className={styles.fastSlPreview + ' ' + styles.fastSPreview}>{fastSlPreview}</div>
          </PanelButton>
          <PanelButton
            icon={<DoubleUp />}
            text={t('buttons.quicklyLoad')}
            onClick={() => {
              loadGame(0);
            }}
            small={true}
            className={styles.fastLoad}
          >
            <div className={styles.fastSlPreview + ' ' + styles.fastLPreview}>{fastSlPreview}</div>
          </PanelButton>
          <PanelButton
            icon={<Save />}
            text={t('buttons.save')}
            onClick={() => {
              setMenuPanel(MenuPanelTag.Save);
              setComponentVisibility('showMenuPanel', true);
            }}
            small={true}
          />
          <PanelButton
            icon={<FolderOpen />}
            text={t('buttons.load')}
            onClick={() => {
              setMenuPanel(MenuPanelTag.Load);
              setComponentVisibility('showMenuPanel', true);
            }}
            small={true}
          />
          {GUIStore.showTextBox && (
            <PanelButton
              icon={<PreviewCloseOne />}
              text={t('buttons.hide')}
              onClick={() => {
                setComponentVisibility('showTextBox', false);
              }}
              small={true}
            />
          )}{' '}
          {!GUIStore.showTextBox && (
            <PanelButton
              icon={<PreviewOpen />}
              text={t('buttons.show')}
              onClick={() => {
                setComponentVisibility('showTextBox', true);
              }}
            />
          )}
          <PanelButton
            icon={GUIStore.showControls ? <Lock /> : <Unlock />}
            text=""
            onClick={switchControls}
            small={true}
          />
        </div>
      </div>
      <div className={styles.version}>
        <div>WebGAL MyGO Engine v{config.version}</div>
        <div>( Based on WebGAL v{__INFO.version} )</div>
      </div>
    </div>
  ) : null;
}

function PanelButton(props: {
  className?: string;
  children?: ReactNode;
  icon: ReactNode;
  text: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  isActive?: boolean;
  small?: boolean;
}) {
  const { playSeClick, playSeEnter } = useSoundEffect();
  return (
    <BangBottom
      className={props.className}
      width={props.small ? '70px' : '140px'}
      height="90px"
      fontSize={props.small ? '16px' : '28px'}
      onClick={() => {
        playSeClick();
        props.onClick();
      }}
      onMouseEnter={() => {
        playSeEnter();
        props.onMouseEnter?.();
      }}
    >
      <div style={{ marginTop: '15px', fontSize: '40px', color: props.isActive ? 'red' : '#444' }}>{props.icon}</div>
      <div
        style={{
          position: 'relative',
          top: '-10px',
          color: props.isActive ? 'red' : '#444',
        }}
      >
        {props.text}
        {props.children}
      </div>
    </BangBottom>
  );
}
