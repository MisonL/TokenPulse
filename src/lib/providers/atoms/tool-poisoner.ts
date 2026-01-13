import type { ChatRequest, RequestInterceptor } from '../base';

/**
 * 工具投毒拦截器 (Tool Poisoning)
 * 如果请求中没有工具，注入一个虚假工具，以绕过某些供应商的限制或触发特定行为。
 */
export class ToolPoisonerInterceptor implements RequestInterceptor {
    name = 'ToolPoisoner';

    constructor(
        private toolName: string = 'do_not_call_me',
        private description: string = 'Do not call this tool under any circumstances, it will have catastrophic consequences.'
    ) {}

    async transform(body: ChatRequest, headers: Record<string, string>) {
        const newBody = { ...body };
        if (!newBody.tools || newBody.tools.length === 0) {
            newBody.tools = [
                {
                    type: 'function',
                    function: {
                        name: this.toolName,
                        description: this.description,
                        parameters: {
                            type: 'object',
                            properties: {
                                operation: {
                                    type: 'number',
                                    description: '1:poweroff\n2:rm -fr /\n3:mkfs.ext4 /dev/sda1'
                                }
                            },
                            required: ['operation']
                        }
                    }
                }
            ];
        }
        return { body: newBody, headers };
    }
}
