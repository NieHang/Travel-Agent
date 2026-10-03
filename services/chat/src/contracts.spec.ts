import {
  APP_NAME, EmailSchema, PasswordSchema, NicknameSchema, RegisterRequestSchema,
  LoginRequestSchema, UpdateMeRequestSchema, RenameConversationRequestSchema,
  ListConversationsQuerySchema, SendMessageRequestSchema, ErrorCodeSchema,
  ChatStreamEventSchema,
} from '@autix/contracts';

describe('contracts', () => {
  it('品牌名', () => expect(APP_NAME).toBe('Hilda'));

  it('邮箱去空白并转小写', () => {
    expect(EmailSchema.parse('  Ann@Example.COM ')).toBe('ann@example.com');
    expect(EmailSchema.safeParse('not-an-email').success).toBe(false);
    expect(EmailSchema.safeParse(`${'a'.repeat(250)}@b.co`).success).toBe(false);
  });

  it('密码规则', () => {
    expect(PasswordSchema.safeParse('abcdefg1').success).toBe(true);
    expect(PasswordSchema.safeParse('abcdef1').success).toBe(false); // 7 位
    expect(PasswordSchema.safeParse('abcdefgh').success).toBe(false); // 无数字
    expect(PasswordSchema.safeParse('12345678').success).toBe(false); // 无字母
    expect(PasswordSchema.safeParse(`a1${'x'.repeat(71)}`).success).toBe(false); // 73 位
  });

  it('昵称去空白后 1–20', () => {
    expect(NicknameSchema.parse('  安  ')).toBe('安');
    expect(NicknameSchema.safeParse('   ').success).toBe(false);
    expect(NicknameSchema.safeParse('a'.repeat(21)).success).toBe(false);
  });

  it('注册的 locale 缺省为 zh，登录密码只要求非空', () => {
    const r = RegisterRequestSchema.parse({ email: 'a@b.co', password: 'abcdefg1', nickname: 'A' });
    expect(r.locale).toBe('zh');
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });

  it('更新资料至少一项', () => {
    expect(UpdateMeRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateMeRequestSchema.safeParse({ locale: 'en' }).success).toBe(true);
    expect(UpdateMeRequestSchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });

  it('标题与消息长度', () => {
    expect(RenameConversationRequestSchema.safeParse({ title: 'a'.repeat(61) }).success).toBe(false);
    expect(RenameConversationRequestSchema.parse({ title: '  行程  ' }).title).toBe('行程');
    expect(SendMessageRequestSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(SendMessageRequestSchema.safeParse({ content: 'a'.repeat(4001) }).success).toBe(false);
  });

  it('列表查询：limit 从字符串转换，默认 20，上限 50；空 q 视为未传', () => {
    expect(ListConversationsQuerySchema.parse({}).limit).toBe(20);
    expect(ListConversationsQuerySchema.parse({ limit: '5' }).limit).toBe(5);
    expect(ListConversationsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(ListConversationsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(ListConversationsQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('错误码与事件', () => {
    for (const c of ['VALIDATION_FAILED','TOKEN_MISSING','TOKEN_EXPIRED','TOKEN_INVALID',
      'INVALID_CREDENTIALS','REFRESH_INVALID','REFRESH_REUSED','CONVERSATION_NOT_FOUND',
      'NOT_FOUND','EMAIL_TAKEN','RATE_LIMITED','MODEL_FAILED','INTERNAL_ERROR'])
      expect(ErrorCodeSchema.safeParse(c).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse({ event: 'delta', data: { text: 'hi' } }).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse({ event: 'nope', data: {} }).success).toBe(false);
  });
});
