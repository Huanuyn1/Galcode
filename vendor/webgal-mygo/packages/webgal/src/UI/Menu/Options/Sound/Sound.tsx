import styles from '@/UI/Menu/Options/options.module.scss';
import { NormalOption } from '@/UI/Menu/Options/NormalOption';
import { CustomSlider } from '@/UI/Menu/Options/CustomSlider';
import { NormalButton } from '@/UI/Menu/Options//NormalButton';
import { setOptionData } from '@/store/userDataReducer';
import { setStorage } from '@/Core/controller/storage/storageController';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store/store';
import useTrans from '@/hooks/useTrans';
import { voiceOption } from '@/store/userDataInterface';

export function Sound() {
  const userDataState = useSelector((state: RootState) => state.userData);
  const dispatch = useDispatch();
  const t = useTrans('menu.options.pages.sound.options.');

  return (
    <div className={styles.Options_main_content_half}>
      <NormalOption key="option4" title={t('volumeMain.title')}>
        <CustomSlider
          value={userDataState.optionData.volumeMain}
          onChange={(newValue) => {
            dispatch(setOptionData({ key: 'volumeMain', value: newValue }));
            setStorage();
          }}
        />
      </NormalOption>
      <NormalOption key="option5" title={t('vocalVolume.title')}>
        <CustomSlider
          value={userDataState.optionData.vocalVolume}
          onChange={(newValue) => {
            dispatch(setOptionData({ key: 'vocalVolume', value: newValue }));
            setStorage();
          }}
        />
      </NormalOption>
      <NormalOption key="option6" title={t('bgmVolume.title')}>
        <CustomSlider
          value={userDataState.optionData.bgmVolume}
          onChange={(newValue) => {
            dispatch(setOptionData({ key: 'bgmVolume', value: newValue }));
            setStorage();
          }}
        />
      </NormalOption>
      <NormalOption key="option7" title={t('seVolume.title')}>
        <CustomSlider
          value={userDataState.optionData.seVolume}
          onChange={(newValue) => {
            dispatch(setOptionData({ key: 'seVolume', value: newValue }));
            setStorage();
          }}
        />
      </NormalOption>
      <NormalOption key="option8" title={t('uiSeVolume.title')}>
        <CustomSlider
          value={userDataState.optionData.uiSeVolume}
          onChange={(newValue) => {
            dispatch(setOptionData({ key: 'uiSeVolume', value: newValue }));
            setStorage();
          }}
        />
      </NormalOption>
      <NormalOption key="option9" title={t('voiceOption.title')}>
        <NormalButton
          textList={t('voiceStop.title', 'voiceContinue.title')}
          functionList={[
            () => {
              dispatch(setOptionData({ key: 'voiceInterruption', value: voiceOption.yes }));
              setStorage();
            },
            () => {
              dispatch(setOptionData({ key: 'voiceInterruption', value: voiceOption.no }));
              setStorage();
            },
          ]}
          currentChecked={userDataState.optionData.voiceInterruption}
        />
      </NormalOption>
    </div>
  );
}
