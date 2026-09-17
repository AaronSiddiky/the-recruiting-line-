/**
 * Record the microphone straight to 16-bit PCM WAV.
 *
 * MediaRecorder would be simpler, but it produces WebM/Opus (or MP4/AAC on
 * Safari), and Twilio's <Play> accepts neither. Capturing raw samples through
 * the Web Audio graph and writing the WAV header ourselves works everywhere
 * and needs no encoder.
 */
export type WavRecording = {
  stop: () => Promise<Blob>
}

export async function startWavRecording(deviceId?: string): Promise<WavRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessorNode is deprecated but still universally supported; an
  // AudioWorklet would need a separately served module file for a 30s clip.
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []

  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  }
  source.connect(processor)
  processor.connect(ctx.destination)

  return {
    async stop() {
      processor.disconnect()
      source.disconnect()
      for (const track of stream.getTracks()) track.stop()
      const sampleRate = ctx.sampleRate
      await ctx.close()
      return encodeWav(chunks, sampleRate)
    },
  }
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((n, c) => n + c.length, 0)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, length * 2, true)

  let offset = 44
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
