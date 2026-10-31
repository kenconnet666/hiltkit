import { createVaporApp } from 'vue'; // 构建时别名到 vue36（3.6.0-rc）
import { makeBench } from '../data.js';
import App from './App.vue';
import { actions } from './state.js';

createVaporApp(App).mount(document.body.appendChild(document.createElement('div')));
window.bench = makeBench(actions);
