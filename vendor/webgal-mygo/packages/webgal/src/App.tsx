import { useEffect, useRef } from 'react';
import { initializeScript } from '@/Core/initializeScript';
import Translation from '@/UI/Translation/Translation';
import { Stage } from '@/Stage/Stage';
import { BottomControlPanel } from './UI/BottomControlPanel/BottomControlPanel';
import { BangBottomControlPanel } from './UI/BottomControlPanel/BangBottomControlPanel';
import { BottomControlPanelFilm } from '@/UI/BottomControlPanel/BottomControlPanelFilm';
import { Backlog } from '@/UI/Backlog/Backlog';
import Title from '@/UI/Title/Title';
import Logo from '@/UI/Logo/Logo';
import { Extra } from '@/UI/Extra/Extra';
import Menu from '@/UI/Menu/Menu';
import GlobalDialog from '@/UI/GlobalDialog/GlobalDialog';
import PanicOverlay from '@/UI/PanicOverlay/PanicOverlay';
import DevPanel from '@/UI/DevPanel/DevPanel';
import { WebGAL } from './Core/WebGAL';

export default function App() {
  const appRef = useRef<HTMLDivElement>(null);

  const resize = () => {
    if (appRef.current === null) return;

    const app = appRef.current;

    const isVertical = WebGAL.stageWidth < WebGAL.stageHeight;

    const shouldRotate = WebGAL.autoRotate
      ? isVertical
        ? window.innerWidth > window.innerHeight
        : window.innerWidth < window.innerHeight
      : false;
    const rotatedWindowWidth = shouldRotate ? window.innerHeight : window.innerWidth;
    const rotatedWindowHeight = shouldRotate ? window.innerWidth : window.innerHeight;
    const widthRatio = rotatedWindowWidth / WebGAL.stageWidth;
    const heightRatio = rotatedWindowHeight / WebGAL.stageHeight;
    const scale = Math.min(widthRatio, heightRatio);

    app.style.width = `${WebGAL.stageWidth}px`;
    app.style.height = `${WebGAL.stageHeight}px`;
    app.style.scale = `${scale}`;
    app.style.left = `${(rotatedWindowWidth - WebGAL.stageWidth * scale) / 2}px`;
    app.style.top = `${(rotatedWindowHeight - WebGAL.stageHeight * scale) / 2}px`;

    if (shouldRotate) {
      const rotateDegree = isVertical ? -90 : 90;
      document.documentElement.style.width = '100vh';
      document.documentElement.style.height = '100vw';
      document.documentElement.style.transform = `translate(-50%, -50%) rotate(${rotateDegree}deg)`;
    } else {
      document.documentElement.style.width = '100vw';
      document.documentElement.style.height = '100vh';
      document.documentElement.style.transform = 'translate(-50%, -50%) rotate(0deg)';
    }
  };

  useEffect(() => {
    initializeScript().then(() => {
      resize();
    });

    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);
  return (
    <div className="App" ref={appRef}>
      <Translation />
      <Stage />
      <BottomControlPanel />
      <BangBottomControlPanel />
      <BottomControlPanelFilm />
      <Backlog />
      <Title />
      <Logo />
      <Extra />
      <Menu />
      <GlobalDialog />
      <PanicOverlay />
      <DevPanel />
    </div>
  );
}
