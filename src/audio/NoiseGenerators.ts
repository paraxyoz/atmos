/**
 * NoiseGenerators: Procedural generation of White, Pink, and Brown noise AudioBuffers.
 * These buffers are looped seamlessly in Web Audio API.
 */

// Generate 5 seconds of White Noise (Flat spectrum)
export function createWhiteNoiseBuffer(ctx: AudioContext, durationSeconds = 5): AudioBuffer {
  const bufferSize = Math.floor(ctx.sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);
  
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return buffer;
}

// Generate Pink Noise using Paul Kellet's filter method (-3dB/octave)
export function createPinkNoiseBuffer(ctx: AudioContext, durationSeconds = 5): AudioBuffer {
  const bufferSize = Math.floor(ctx.sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11; // scale to ~[-1, 1]
    }
  }
  return buffer;
}

// Generate Brown / Red Noise via integrated random walk (-6dB/octave)
export function createBrownNoiseBuffer(ctx: AudioContext, durationSeconds = 5): AudioBuffer {
  const bufferSize = Math.floor(ctx.sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let lastOut = 0.0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Leaky integration to avoid DC offset drift
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5; // normalize volume
    }
  }
  return buffer;
}
