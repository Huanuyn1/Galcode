import React, { useState, useEffect, useRef, useCallback } from 'react';
import './CustomSlider.scss';

interface SliderProps {
  min?: number;
  max?: number;
  value?: number;
  onChange?: (value: number) => void;
}

export const CustomSlider: React.FC<SliderProps> = ({ min = 0, max = 100, value: externalValue, onChange }) => {
  const [internalValue, setInternalValue] = useState(externalValue || min);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const value = externalValue !== undefined ? externalValue : internalValue;
  const percentage = ((value - min) / (max - min)) * 100;

  // 同步外部值变化
  useEffect(() => {
    if (externalValue !== undefined) {
      setInternalValue(externalValue);
    }
  }, [externalValue]);

  // 计算滑块位置
  const calculateValue = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return min;

      const rect = containerRef.current.getBoundingClientRect();
      const offsetX = clientX - rect.left;
      const width = rect.width;

      let newPercentage = (offsetX / width) * 100;
      newPercentage = Math.max(0, Math.min(100, newPercentage));

      const newValue = min + ((max - min) * newPercentage) / 100;
      return Math.round(newValue);
    },
    [min, max],
  );

  // 鼠标/触摸事件处理
  const startDragging = useCallback(
    (clientX: number) => {
      setIsDragging(true);
      const newValue = calculateValue(clientX);
      if (!externalValue) setInternalValue(newValue);
      onChange?.(newValue);
    },
    [calculateValue, externalValue, onChange],
  );

  const handleMove = useCallback(
    (clientX: number) => {
      if (!isDragging) return;
      const newValue = calculateValue(clientX);
      if (!externalValue) setInternalValue(newValue);
      onChange?.(newValue);
    },
    [isDragging, calculateValue, externalValue, onChange],
  );

  // 事件监听器
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX);

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('touchmove', handleTouchMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchend', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging, handleMove]);

  return (
    <>
      <div ref={containerRef} className="custom-slider">
        {/* 滑轨背景 */}
        <div
          className="custom-slider__track"
          onClick={(e) => {
            if (!isDragging) {
              const newValue = calculateValue(e.clientX);
              if (!externalValue) setInternalValue(newValue);
              onChange?.(newValue);
            }
          }}
        >
          {/* 进度填充 */}
          <div
            className={`custom-slider__progress ${isDragging ? 'custom-slider__progress--dragging' : ''}`}
            style={{
              width: `calc(${percentage}% + 2px)`,
            }}
            onClick={(e) => {
              if (!isDragging) {
                const newValue = calculateValue(e.clientX);
                if (!externalValue) setInternalValue(newValue);
                onChange?.(newValue);
                e.stopPropagation(); // 防止事件冒泡到track
              }
            }}
          />
        </div>

        {/* 自定义滑块 */}
        <div
          ref={thumbRef}
          className={`custom-slider__thumb ${isDragging ? 'custom-slider__thumb--dragging' : ''}`}
          style={{
            left: `${percentage}%`,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            startDragging(e.clientX);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            startDragging(e.touches[0].clientX);
          }}
        />
      </div>

      {/* 当前值显示 */}
      <div className="custom-slider__value">{value}</div>
    </>
  );
};

export default CustomSlider;
