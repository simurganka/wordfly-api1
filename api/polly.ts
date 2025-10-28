// api/polly.ts
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

export default async function handler(req: any) {
    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    // OPTIONS preflight
    if (req.method === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    // POST method kontrolü
    if (req.method !== 'POST') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Use POST' })
        };
    }

    try {
        const { text, languageCode, voiceName, speakingRate, pitch, audioFormat } = req.body;

        if (!text || typeof text !== 'string' || text.trim() === '') {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'text is required' })
            };
        }

        // AWS SDK'yı yükle
        const region = process.env.AWS_REGION || 'eu-central-1';
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

        if (!accessKeyId || !secretAccessKey) {
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'AWS credentials not configured' })
            };
        }

        const polly = new PollyClient({
            region,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });

        const defaultVoice = (languageCode || '').startsWith('tr') ? 'Filiz' : 'Joanna';
        const selectedVoice = (voiceName as string) || defaultVoice;

        let outputFormat = 'mp3';
        if (audioFormat) {
            const f = audioFormat.toLowerCase();
            if (f === 'ogg') outputFormat = 'ogg_vorbis';
            else if (f === 'pcm') outputFormat = 'pcm';
        }

        const cmdInput: any = {
            Text: text,
            VoiceId: selectedVoice as any,
            OutputFormat: outputFormat as any,
            Engine: 'standard',
            TextType: (speakingRate || pitch) ? 'ssml' : 'text',
        };

        if (languageCode) {
            cmdInput.LanguageCode = languageCode;
        }

        if (speakingRate || pitch) {
            const rate = typeof speakingRate === 'number' ? `${Math.round(speakingRate * 100)}%` : '100%';
            const p = typeof pitch === 'number' ? `${Math.round(pitch)}%` : '0%';
            cmdInput.Text = `<speak><prosody rate="${rate}" pitch="${p}">${text}</prosody></speak>`;
        }

        const cmd = new SynthesizeSpeechCommand(cmdInput);
        const result = await polly.send(cmd);
        const audioStream = result.AudioStream;
        if (!audioStream) {
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'No audio stream' })
            };
        }

        // Convert streaming blob to buffer
        const chunks: Uint8Array[] = [];
        if (audioStream instanceof ReadableStream || 'getReader' in audioStream) {
            // It's a ReadableStream or has a getReader method
            const reader = (audioStream as any).getReader();
            let done = false;
            while (!done) {
                const { value, done: streamDone } = await reader.read();
                done = streamDone;
                if (value) {
                    chunks.push(value);
                }
            }
        } else if (audioStream instanceof Uint8Array || audioStream instanceof ArrayBuffer) {
            // It's already a Uint8Array or ArrayBuffer
            chunks.push(new Uint8Array(audioStream));
        } else if (audioStream) {
            // Fallback: try to convert to Uint8Array
            chunks.push(new Uint8Array(await (audioStream as any).arrayBuffer()));
        }
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString('base64');
        const contentType =
            outputFormat === 'mp3' ? 'audio/mpeg' :
                outputFormat === 'ogg_vorbis' ? 'audio/ogg' : 'audio/wav';

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ base64, contentType })
        };
    } catch (e: any) {
        console.error('Polly error:', e);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Polly failed: ' + e.message })
        };
    }
}
