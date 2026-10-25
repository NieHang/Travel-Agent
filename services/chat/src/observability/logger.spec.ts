import { Writable } from 'node:stream';
import pino from 'pino';
import { createLogger, loggerOptions, traceMixin } from './logger.js';
import { runWithTrace } from './trace-context.js';

describe('structured logger', () => {
  it('adds a trace only inside a context', () => {
    expect(traceMixin()).toEqual({});
    runWithTrace('t1', () => expect(traceMixin()).toEqual({ traceId: 't1' }));
    expect(createLogger('example').bindings()).toMatchObject({
      module: 'example',
    });
  });

  it('redacts credentials and emits module and trace fields', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const log = pino({ ...loggerOptions, level: 'info' }, stream).child({
      module: 'example',
    });
    runWithTrace('t1', () =>
      log.info(
        {
          password: 'secret-password',
          apiKey: 'secret-key',
          authorization: 'secret-auth',
          account: {
            password: 'nested-password',
            apiKey: 'nested-key',
            authorization: 'nested-auth',
          },
          headers: { authorization: 'header-auth', cookie: 'header-cookie' },
          req: { headers: { authorization: 'req-auth', cookie: 'req-cookie' } },
        },
        'test',
      ),
    );
    expect(chunks).toHaveLength(1);
    expect(JSON.parse(chunks[0])).toMatchObject({
      module: 'example',
      traceId: 't1',
      msg: 'test',
      password: '[REDACTED]',
      apiKey: '[REDACTED]',
      authorization: '[REDACTED]',
      account: {
        password: '[REDACTED]',
        apiKey: '[REDACTED]',
        authorization: '[REDACTED]',
      },
      headers: { authorization: '[REDACTED]', cookie: '[REDACTED]' },
      req: { headers: { authorization: '[REDACTED]', cookie: '[REDACTED]' } },
    });
  });
});
