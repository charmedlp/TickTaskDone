import { createApp } from 'vue'
import { createPinia } from 'pinia'

import '@/assets/base.css'
import App from './App.vue'
import router from './router'
import { i18n, initialLocale, setLocale } from '@/i18n'

// Best-effort locale before the user's stored preference loads (App.vue then applies
// user.locale from the API).
setLocale(initialLocale())

const app = createApp(App)

app.use(createPinia())
app.use(i18n)
app.use(router)

app.mount('#app')
