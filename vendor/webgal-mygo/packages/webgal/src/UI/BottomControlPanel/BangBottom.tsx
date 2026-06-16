import React from 'react';
import styles from './bangBottom.module.scss';

export function BangBottom(props: {
  className?: string;
  children: React.ReactNode;
  width: string;
  height: string;
  fontSize?: string;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <div
      className={(props.className ? props.className + ' ' : '') + styles.button}
      onClick={props.onClick}
      onMouseEnter={props.onMouseEnter}
    >
      <div className={styles.inner} style={{ width: props.width, height: props.height, fontSize: props.fontSize }}>
        {props.children}
      </div>
    </div>
  );
}
