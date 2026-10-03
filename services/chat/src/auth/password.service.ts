import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// 默认算法即 argon2id；预先算好的固定哈希用于抵消"用户不存在"时的时间差。
const dummyHash = hash('dummy-password-for-timing');

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  }

  async verifyDummy(plain: string): Promise<void> {
    await this.verify(await dummyHash, plain);
  }
}
