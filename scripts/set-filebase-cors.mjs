/**
 * Applies the bucket CORS policy that browser uploads need.
 *
 * The browser PUTs straight to Filebase with a presigned URL, so the bucket
 * must answer the preflight OPTIONS with Access-Control-Allow-Origin. Without
 * it the PUT is blocked before it leaves the browser.
 *
 * Usage:
 *   pnpm cors:apply                      # localhost dev origins
 *   pnpm cors:apply https://app.example.com
 *   CORS_ORIGINS=https://a.com,https://b.com pnpm cors:apply
 *
 * Origins from PUBLIC_APP_ORIGIN / APP_ORIGIN are added automatically when set.
 */
import 'dotenv/config';
import {
	GetBucketCorsCommand,
	PutBucketCorsCommand,
	S3Client
} from '@aws-sdk/client-s3';

const bucket = process.env.FILEBASE_BUCKET ?? process.env.R2_BUCKET ?? 'revisia';
const endpoint = process.env.FILEBASE_ENDPOINT ?? 'https://s3.filebase.io';
const accessKeyId = process.env.FILEBASE_ACCESS_KEY_ID ?? process.env.R2_ACCESS_KEY_ID ?? '';
const secretAccessKey =
	process.env.FILEBASE_SECRET_ACCESS_KEY ?? process.env.R2_SECRET_ACCESS_KEY ?? '';

if (!accessKeyId || !secretAccessKey) {
	console.error('Falta FILEBASE_ACCESS_KEY_ID / FILEBASE_SECRET_ACCESS_KEY');
	process.exit(1);
}

const DEV_ORIGINS = [
	'http://localhost:5173',
	'http://127.0.0.1:5173',
	'http://localhost:5174',
	'http://127.0.0.1:5174'
];

const fromArgs = process.argv.slice(2);
const fromEnv = (process.env.CORS_ORIGINS ?? '')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);
const fromApp = [process.env.PUBLIC_APP_ORIGIN, process.env.APP_ORIGIN]
	.filter((value) => Boolean(value))
	.map((value) => new URL(value).origin);

const allowedOrigins = [
	...new Set(
		(fromArgs.length > 0 ? fromArgs : [...DEV_ORIGINS, ...fromEnv, ...fromApp]).map(
			(value) => new URL(value).origin
		)
	)
];

const rules = [
	{
		AllowedOrigins: allowedOrigins,
		AllowedMethods: ['PUT', 'GET', 'HEAD'],
		AllowedHeaders: ['*'],
		ExposeHeaders: ['ETag'],
		MaxAgeSeconds: 3000
	}
];

const client = new S3Client({
	region: 'auto',
	endpoint,
	credentials: { accessKeyId, secretAccessKey },
	requestChecksumCalculation: 'WHEN_REQUIRED',
	responseChecksumValidation: 'WHEN_REQUIRED'
});

console.log(`Bucket: ${bucket}`);
console.log(`Endpoint: ${endpoint}`);
console.log('AllowedOrigins:', allowedOrigins.join(', '));

await client.send(
	new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } })
);

const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log('CORS aplicado:');
console.log(JSON.stringify(current.CORSRules, null, 2));
