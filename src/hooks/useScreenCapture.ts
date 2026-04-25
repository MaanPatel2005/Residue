'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ProductivitySnapshot } from '@/types';

const CAPTURE_INTERVAL = 30_000; // 30 seconds
const INACTIVITY_THRESHOLD = 0.02; // 2% pixel change = inactive

function compareImages(
  prev: ImageData,
  curr: ImageData
): number {
  const len = prev.data.length;
  let diffPixels = 0;
  const totalPixels = len / 4;

  for (let i = 0; i < len; i += 4) {
    const rDiff = Math.abs(prev.data[i] - curr.data[i]);
    const gDiff = Math.abs(prev.data[i + 1] - curr.data[i + 1]);
    const bDiff = Math.abs(prev.data[i + 2] - curr.data[i + 2]);
    if (rDiff + gDiff + bDiff > 30) {
      diffPixels++;
    }
  }

  return diffPixels / totalPixels;
}

export function useScreenCapture() {
  const [isTracking, setIsTracking] = useState(false);
  const [currentSnapshot, setCurrentSnapshot] = useState<ProductivitySnapshot | null>(null);
  const [productivityHistory, setProductivityHistory] = useState<ProductivitySnapshot[]>([]);
  const [screenPreview, setScreenPreview] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevImageRef = useRef<ImageData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inactiveCountRef = useRef(0);

  const captureFrame = useCallback(() => {
    const stream = streamRef.current;
    const canvas = canvasRef.current;
    if (!stream || !canvas) return;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.play().then(() => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = 320;
      canvas.height = 180;
      ctx.drawImage(video, 0, 0, 320, 180);

      setScreenPreview(canvas.toDataURL('image/jpeg', 0.5));

      const currentImage = ctx.getImageData(0, 0, 320, 180);
      let changePercentage = 1;
      let screenChanged = true;

      if (prevImageRef.current) {
        changePercentage = compareImages(prevImageRef.current, currentImage);
        screenChanged = changePercentage > INACTIVITY_THRESHOLD;
      }

      prevImageRef.current = currentImage;

      if (!screenChanged) {
        inactiveCountRef.current++;
      } else {
        inactiveCountRef.current = Math.max(0, inactiveCountRef.current - 1);
      }

      const recentActivity = Math.max(0, 1 - inactiveCountRef.current * 0.15);
      const productivityScore = Math.round(
        (screenChanged ? 70 + changePercentage * 30 : 20 - inactiveCountRef.current * 5) *
          recentActivity
      );

      const snapshot: ProductivitySnapshot = {
        timestamp: Date.now(),
        screenChanged,
        changePercentage: Math.round(changePercentage * 100),
        productivityScore: Math.max(0, Math.min(100, productivityScore)),
      };

      setCurrentSnapshot(snapshot);
      setProductivityHistory((prev) => [...prev.slice(-59), snapshot]);

      video.pause();
      video.srcObject = null;
    });
  }, []);

  const stopTracking = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    }
    streamRef.current = null;
    prevImageRef.current = null;
    inactiveCountRef.current = 0;
    setIsTracking(false);
  }, []);

  const startTracking = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
      });

      streamRef.current = stream;
      canvasRef.current = document.createElement('canvas');

      stream.getVideoTracks()[0].onended = () => {
        stopTracking();
      };

      setIsTracking(true);
      captureFrame();
      intervalRef.current = setInterval(captureFrame, CAPTURE_INTERVAL);
    } catch (err) {
      console.error('Screen capture denied:', err);
    }
  }, [captureFrame, stopTracking]);

  const submitSelfReport = useCallback(
    (rating: number) => {
      if (currentSnapshot) {
        const updated = { ...currentSnapshot, selfReport: rating };
        setCurrentSnapshot(updated);
        setProductivityHistory((prev) => {
          const copy = [...prev];
          if (copy.length > 0) {
            copy[copy.length - 1] = updated;
          }
          return copy;
        });
      }
    },
    [currentSnapshot]
  );

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    isTracking,
    currentSnapshot,
    productivityHistory,
    screenPreview,
    startTracking,
    stopTracking,
    submitSelfReport,
  };
}
