/**
 * The API password is stored encrypted (AES-256-GCM). The key comes from `COBRIX_SECRET_KEY`
 * (any string, hashed to 32 bytes) or, if unset, from a key file generated next to the data.
 * In memory (tests) a random per-process key is enough.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SecretCipher } from '../../application/ports/store.ts'

export class SecretBox implements SecretCipher {
	private readonly key: Buffer

	constructor(key: Buffer) {
		this.key = key
	}

	static fromEnvironment(dataDir?: string): SecretBox {
		const configured = process.env.COBRIX_SECRET_KEY
		if (configured) return new SecretBox(createHash('sha256').update(configured).digest())
		if (!dataDir) return new SecretBox(randomBytes(32))
		const file = join(dataDir, 'secret.key')
		if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 })
		return new SecretBox(Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'))
	}

	seal(plain: string): string {
		if (plain === '') return ''
		const iv = randomBytes(12)
		const cipher = createCipheriv('aes-256-gcm', this.key, iv)
		const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
		return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64')).join('.')
	}

	/** `undefined` when it cannot be opened (e.g. the key changed): the operator must type it again. */
	open(sealed: string): string | undefined {
		if (sealed === '') return ''
		try {
			const [iv, tag, data] = sealed.split('.').map(part => Buffer.from(part, 'base64')) as [Buffer, Buffer, Buffer]
			const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
			decipher.setAuthTag(tag)
			return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
		} catch {
			return undefined
		}
	}
}
