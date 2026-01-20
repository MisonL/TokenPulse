import { db } from "../../db";
import { settings } from "../../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

/**
 * 基础设施注册中心 (Infrastructure Registry)
 * 用于持久化供应商的动态凭据、Discovery 信息等非用户特定的元数据。
 */
export class InfrastructureRegistry {
  /**
   * 获取注册信息
   * @param key 唯一标识符 (例如：'kiro_client_creds')
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const result = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key))
        .get();
      if (!result) return null;
      return JSON.parse(result.value) as T;
    } catch (e: any) {
      logger.error(`InfrastructureRegistry Error (get ${key}): ${e.message}`);
      return null;
    }
  }

  /**
   * 设置注册信息
   * @param key 唯一标识符
   * @param value 要保存的对象
   * @param description 描述信息
   */
  static async set(
    key: string,
    value: any,
    description?: string,
  ): Promise<void> {
    try {
      const valStr = JSON.stringify(value);
      await db
        .insert(settings)
        .values({
          key,
          value: valStr,
          description: description || `Auto-persistent registry for ${key}`,
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            value: valStr,
            description: description || undefined,
            updatedAt: new Date().toISOString(),
          },
        });
    } catch (e: any) {
      logger.error(`InfrastructureRegistry Error (set ${key}): ${e.message}`);
    }
  }

  /**
   * 删除注册信息
   * @param key
   */
  static async delete(key: string): Promise<void> {
    try {
      await db.delete(settings).where(eq(settings.key, key));
    } catch (e: any) {
      logger.error(
        `InfrastructureRegistry Error (delete ${key}): ${e.message}`,
      );
    }
  }
}
