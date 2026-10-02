describe('basic requirement tools', () => {
  it.each([
    ['密码至少8位', '密码至少8位', true],
    ['必须绑定手机号', '用户注册时必须绑定手机号', true],
    ['不得重复注册', '不得重复注册', true],
    ['不能使用空密码', '不能使用空密码', true],
    ['推荐使用长密码', '推荐使用长密码', false],
    ['密码至少8位', '用户可以自由设置密码', false],
    ['  ', '用户注册', false],
  ])(
    'checks whether %s is an explicit constraint grounded in the input',
    async (constraint, input, valid) => {
      const { checkConstraintValidity } = await import('./basic.tools.js');
      const result = JSON.parse(
        await checkConstraintValidity.invoke({ constraint, input }),
      );
      expect(result).toMatchObject({ valid });
      expect(result.reason).toEqual(expect.any(String));
    },
  );

  it('looks up known entities and does not invent definitions for unknown names', async () => {
    const { lookupEntityDefinition } = await import('./basic.tools.js');
    expect(
      JSON.parse(await lookupEntityDefinition.invoke({ entity: ' 手机号 ' })),
    ).toMatchObject({
      entity: '手机号',
      found: true,
      definition: expect.any(String),
    });
    for (const entity of ['未知实体', 'toString', '__proto__']) {
      expect(
        JSON.parse(await lookupEntityDefinition.invoke({ entity })),
      ).toEqual({ entity, found: false, definition: null });
    }
  });

  it('rejects missing and incorrectly typed tool arguments', async () => {
    const { checkConstraintValidity, lookupEntityDefinition } =
      await import('./basic.tools.js');
    await expect(
      checkConstraintValidity.invoke({ constraint: '必须绑定手机号' }),
    ).rejects.toThrow();
    await expect(
      lookupEntityDefinition.invoke({ entity: 42 }),
    ).rejects.toThrow();
  });
});
