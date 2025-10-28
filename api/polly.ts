// api/polly.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // OPTIONS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).send('');
    }

    // POST method kontrolü
    if (req.method !== 'POST') {
        return res.status(405).setHeader('Content-Type', 'application/json')
            .setHeader('Access-Control-Allow-Origin', '*')
            .send(JSON.stringify({ error: 'Use POST' }));
    }

    try {
        const { text, languageCode, voiceName, speakingRate, pitch, audioFormat } = req.body;

        if (!text || typeof text !== 'string' || text.trim() === '') {
            return res.status(400).setHeader('Content-Type', 'application/json')
                .setHeader('Access-Control-Allow-Origin', '*')
                .send(JSON.stringify({ error: 'text is required' }));
        }

        const region = process.env.AWS_REGION || 'eu-central-1';

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
        const selectedVoice = voiceName || defaultVoice;

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

        const result = await polly.send(cmd);
        const audioStream = result.AudioStream;
        if (!audioStream) {
            return res.status(500).setHeader('Content-Type', 'application/json')
                .setHeader('Access-Control-Allow-Origin', '*')
                .send(JSON.stringify({ error: 'No audio stream' }));
        }

        const buffer = Buffer.from(await audioStream.transformToByteArray());
        const base64 = buffer.toString('base64');
        const contentType =
            outputFormat === 'mp3' ? 'audio/mpeg' :
                outputFormat === 'ogg_vorbis' ? 'audio/ogg' : 'audio/wav';

        return res.status(200).setHeader('Content-Type', 'application/json')
            .setHeader('Access-Control-Allow-Origin', '*')
            .send(JSON.stringify({ base64, contentType }));
    } catch (e: any) {
        console.error('Polly error:', e);
        return res.status(500).setHeader('Content-Type', 'application/json')
            .setHeader('Access-Control-Allow-Origin', '*')
            .send(JSON.stringify({ error: 'Polly failed: ' + e.message }));
    }
}
