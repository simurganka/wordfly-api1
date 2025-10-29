// api/polly.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const setCorsHeaders = () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json');
    };

    if (req.method === 'OPTIONS') {
        setCorsHeaders();
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        setCorsHeaders();
        return res.status(405).send(JSON.stringify({ error: 'Use POST' }));
    }

    try {
        const { text, languageCode, voiceName, speakingRate, pitch, audioFormat } = req.body;

        if (!text || typeof text !== 'string' || text.trim() === '') {
            setCorsHeaders();
            return res.status(400).send(JSON.stringify({ error: 'text is required' }));
        }

        const region = process.env.AWS_REGION || 'eu-north-1';

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            setCorsHeaders();
            return res.status(500).send(JSON.stringify({ error: 'AWS credentials not configured' }));
        }

        const polly = new PollyClient({
            region,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });

        // Her dil için Polly sesi
        const getVoiceForLanguage = (lang: string) => {
            switch (lang) {
                case 'en': return 'Joanna';
                case 'fr': return 'Celine';
                case 'it': return 'Giorgio';
                case 'es': return 'Enrique';
                case 'ko': return 'Seoyeon';
                case 'zh': return 'Zhiyu';
                case 'ja': return 'Mizuki';
                case 'de': return 'Vicki';
                default: return 'Joanna';
            }
        };

        const selectedVoice = voiceName || getVoiceForLanguage(languageCode);

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
            setCorsHeaders();
            return res.status(500).send(JSON.stringify({ error: 'No audio stream' }));
        }

        const buffer = Buffer.from(await audioStream.transformToByteArray());
        const base64 = buffer.toString('base64');
        const contentType =
            outputFormat === 'mp3' ? 'audio/mpeg' :
                outputFormat === 'ogg_vorbis' ? 'audio/ogg' : 'audio/wav';

        setCorsHeaders();
        return res.status(200).send(JSON.stringify({ base64, contentType }));

    } catch (e: any) {
        console.error('Polly error:', e);
        setCorsHeaders();
        return res.status(500).send(JSON.stringify({ error: 'Polly failed: ' + e.message }));
    }
}
