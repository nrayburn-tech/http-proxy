/*
  examples-test.js: Test to run all the examples

  Copyright (c) 2013 - 2016 Charlie Robbins, Jarrett Cruger & the Contributors.

*/
import { join } from 'path';
import { readdir } from 'fs/promises';
import { spawn } from 'child_process';
import { describe, expect, it } from 'vitest';

const rootDir = join(__dirname, '..'),
  examplesDir = join(rootDir, 'examples');

describe.skip('http-proxy examples', function () {
  describe('Before testing examples', () => {
    it(
      'should have installed dependencies',
      async () => {
        let files = await readdir(examplesDir);
        if (files.indexOf('node_modules') === -1) {
          await new Promise((resolve, reject) => {
            const child = spawn('npm', ['install', '-f', '--save=false'], {
              cwd: examplesDir,
            });
            child.on('exit', function (code) {
              return code
                ? reject(
                    new Error('npm install exited with non-zero exit code'),
                  )
                : resolve();
            });
          });
        }
        files = await readdir(examplesDir);
        if (files.indexOf('node_modules') === -1) {
          throw new Error('node_modules does not exist after install');
        }
      },
      30 * 1000,
    );
  });

  describe('Requiring all the examples', () => {
    it('should have no errors', async () => {
      for (const dir of ['balancer', 'http', 'middleware', 'websocket']) {
        const files = await readdir(join(rootDir, 'examples', dir));
        files.forEach((file) => {
          let example;
          expect(
            () => (example = require(join(examplesDir, dir, file))),
          ).not.toThrow();
          expect(typeof example).toBe('object');
          expect(example).not.toBeNull();
          expect(example).not.toBeUndefined();
        });
      }
    });
  });
});
