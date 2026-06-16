import { WebgalCore } from '@/Core/webgalCore';

export const useIsWaiting = (WebGAL: WebgalCore) => {
  WebGAL.gameplay.isWaitingInterval = setInterval(() => {
    checkIsWaiting(WebGAL);
  }, 100);
};

const checkIsWaiting = (WebGAL: WebgalCore) => {
  let isBlocking = false;
  WebGAL.gameplay.performController.performList.forEach((e) => {
    if (e.blockingAuto()) isBlocking = true;
  });
  if (isBlocking) {
    hideIsWaiting(WebGAL);
  } else {
    showIsWaiting(WebGAL);
  }
};

const showIsWaiting = (WebGAL: WebgalCore) => {
  if (WebGAL.gameplay.isWaiting) return;
  WebGAL.gameplay.isWaiting = true;
};

const hideIsWaiting = (WebGAL: WebgalCore) => {
  if (!WebGAL.gameplay.isWaiting) return;
  WebGAL.gameplay.isWaiting = false;
};
