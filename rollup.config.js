import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'

const tsconfig = './tsconfig.json'

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.cjs.js',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      typescript({ tsconfig }),
      resolve({
        preferBuiltins: true,
      }),
      commonjs(),
    ],
    external: ['ws'],
  },
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/browser/neuro-game-sdk.min.js',
        format: 'umd',
        name: 'NeuroGameSdk',
        sourcemap: true,
      },
    ],
    plugins: [
      typescript({ tsconfig, declaration: false, declarationMap: false }),
      resolve({
        browser: true,
      }),
      commonjs(),
    ],
  },
]
