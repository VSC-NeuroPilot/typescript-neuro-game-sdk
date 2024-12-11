import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.cjs.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'dist/browser/neuro-game-sdk.min.js',
        format: 'umd',
        name: 'NeuroGameSdk',
        sourcemap: true,
      },
    ],
    plugins: [
      resolve({
        browser: true,
      }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
    ],
  },
]
