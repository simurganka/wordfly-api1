// api/polly.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
        
        // AWS credentials kontrolü
        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            return res.status(500).setHeader('Content-Type', 'application/json')
                .setHeader('Access-Control-Allow-Origin', '*')
                .send(JSON.stringify({ error: 'AWS credentials not configured' }));
        }
        
        const polly = new PollyClient({
            region,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
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

        const cmd = new SynthesizeSpeechCommand({
            Text: text,
            VoiceId: selectedVoice as any,
            LanguageCode: languageCode as any,
            OutputFormat: outputFormat as any,
            Engine: 'standard',
            TextType: (speakingRate || pitch) ? 'ssml' : 'text',
        });

        if (speakingRate || pitch) {
            const rate = typeof speakingRate === 'number' ? `${Math.round(speakingRate * 100)}%` : '100%';
            const p = typeof pitch === 'number' ? `${Math.round(pitch)}%` : '0%';
            (cmd.input as any).Text = `<speak><prosody rate="${rate}" pitch="${p}">${text}</prosody></speak>`;
        }

        console.log('Sending Polly request:', {
            text: text.substring(0, 50) + '...',
            voiceId: selectedVoice,
            languageCode,
            outputFormat
        });

        const result = await polly.send(cmd);
        const audioStream = result.AudioStream;

        console.log('Polly response:', {
            hasAudioStream: !!audioStream,
            audioStreamType: typeof audioStream,
            audioStreamConstructor: audioStream?.constructor?.name
        });

        if (!audioStream) {
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'No audio stream' })
            };
        }

        const buffer = Buffer.from(await audioStream.transformToByteArray());

        console.log('Buffer created:', {
            bufferLength: buffer.length,
            bufferType: buffer.constructor.name
        });

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