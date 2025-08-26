import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export const initFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();

  const baseURL = '/ffmpeg';

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  return ffmpeg;
};

// Helper to convert FFmpeg file data to a format that Blob accepts
const toBlobCompatibleData = (data: any): BlobPart[] => {
  if (data instanceof Uint8Array) {
    // Create a new Uint8Array with a proper ArrayBuffer
    const arrayBuffer = new ArrayBuffer(data.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    uint8Array.set(data);
    return [uint8Array];
  }
  
  if (typeof data === 'string') {
    return [data];
  }
  
  if (data instanceof ArrayBuffer) {
    return [new Uint8Array(data)];
  }
  
  if (data && typeof data.length === 'number') {
    // Convert array-like object to proper Uint8Array
    const arrayBuffer = new ArrayBuffer(data.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < data.length; i++) {
      uint8Array[i] = data[i];
    }
    return [uint8Array];
  }
  
  // Fallback: empty array
  return [new Uint8Array(0)];
};

export const generateThumbnail = async (
  videoFile: File,
  timeInSeconds: number = 1
): Promise<string> => {
  const ffmpeg = await initFFmpeg();
  const inputName = 'input.mp4';
  const outputName = 'thumbnail.jpg';

  await ffmpeg.writeFile(inputName, new Uint8Array(await videoFile.arrayBuffer()));

  await ffmpeg.exec([
    '-i', inputName,
    '-ss', timeInSeconds.toString(),
    '-vframes', '1',
    '-vf', 'scale=320:240',
    '-q:v', '2',
    outputName
  ]);

  const data = await ffmpeg.readFile(outputName);
  const blobData = toBlobCompatibleData(data);
  const blob = new Blob(blobData, { type: 'image/jpeg' });

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return URL.createObjectURL(blob);
};

export const trimVideo = async (
  videoFile: File,
  startTime: number,
  endTime: number,
  onProgress?: (progress: number) => void
): Promise<Blob> => {
  const ffmpeg = await initFFmpeg();
  const inputName = 'input.mp4';
  const outputName = 'output.mp4';

  if (onProgress) ffmpeg.on('progress', ({ progress }) => onProgress(progress * 100));

  await ffmpeg.writeFile(inputName, new Uint8Array(await videoFile.arrayBuffer()));
  const duration = endTime - startTime;

  await ffmpeg.exec([
    '-i', inputName,
    '-ss', startTime.toString(),
    '-t', duration.toString(),
    '-c', 'copy',
    outputName
  ]);

  const data = await ffmpeg.readFile(outputName);
  const blobData = toBlobCompatibleData(data);
  const blob = new Blob(blobData, { type: 'video/mp4' });

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return blob;
};

export const convertToWebM = async (
  videoFile: File,
  onProgress?: (progress: number) => void
): Promise<Blob> => {
  const ffmpeg = await initFFmpeg();
  const inputName = 'input.mp4';
  const outputName = 'output.webm';

  if (onProgress) ffmpeg.on('progress', ({ progress }) => onProgress(progress * 100));

  await ffmpeg.writeFile(inputName, new Uint8Array(await videoFile.arrayBuffer()));

  await ffmpeg.exec([
    '-i', inputName,
    '-c:v', 'libvpx-vp9',
    '-crf', '30',
    '-b:v', '0',
    '-c:a', 'libopus',
    outputName
  ]);

  const data = await ffmpeg.readFile(outputName);
  const blobData = toBlobCompatibleData(data);
  const blob = new Blob(blobData, { type: 'video/webm' });

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return blob;
};

export const extractAudio = async (
  videoFile: File,
  format: 'mp3' | 'wav' = 'mp3'
): Promise<Blob> => {
  const ffmpeg = await initFFmpeg();
  const inputName = 'input.mp4';
  const outputName = `output.${format}`;

  await ffmpeg.writeFile(inputName, new Uint8Array(await videoFile.arrayBuffer()));

  await ffmpeg.exec([
    '-i', inputName,
    '-vn',
    '-acodec', format === 'mp3' ? 'libmp3lame' : 'pcm_s16le',
    outputName
  ]);

  const data = await ffmpeg.readFile(outputName);
  const blobData = toBlobCompatibleData(data);
  const blob = new Blob(blobData, { type: `audio/${format}` });

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return blob;
};

export const getVideoInfo = async (videoFile: File): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
}> => {
  const ffmpeg = await initFFmpeg();
  const inputName = 'input.mp4';

  await ffmpeg.writeFile(inputName, new Uint8Array(await videoFile.arrayBuffer()));

  let ffmpegOutput = '';
  let listening = true;
  const listener = (data: string) => { if (listening) ffmpegOutput += data; };
  ffmpeg.on('log', ({ message }) => listener(message));

  try {
    await ffmpeg.exec(['-i', inputName, '-f', 'null', '-']);
  } catch (error) {
    listening = false;
    await ffmpeg.deleteFile(inputName);
    console.error('FFmpeg execution failed:', error);
    throw new Error('Failed to extract video info. The file may be corrupted or unsupported.');
  }
  listening = false;

  await ffmpeg.deleteFile(inputName);

  const durationMatch = ffmpegOutput.match(/Duration: (\d+):(\d+):([\d.]+)/);
  let duration = 0;
  if (durationMatch) {
    const [, h, m, s] = durationMatch;
    duration = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
  }

  const videoStreamMatch = ffmpegOutput.match(/Video:.* (\d+)x(\d+)[^,]*, ([\d.]+) fps/);
  let width = 0, height = 0, fps = 0;
  if (videoStreamMatch) {
    width = parseInt(videoStreamMatch[1]);
    height = parseInt(videoStreamMatch[2]);
    fps = parseFloat(videoStreamMatch[3]);
  }

  return { duration, width, height, fps };
};