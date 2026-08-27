# QA E2E sintético AVIORA

Esta camada usa Playwright contra `aviora-v82.preview.local.html`. O cenário é inteiramente local, determinístico e mantido em memória: não cria usuários, não usa credenciais reais e não abre conexão com Supabase, Edge, Kiwify ou produção.

## Cobertura

- Chromium, WebKit e Firefox.
- 375×812, 390×844, 430×932, tablet e desktop.
- Login sintético, navegação, menu mobile, Dashboard, Lançamentos, Planejamento, Contas, Cartões, Categorias, Metas, Recorrências, Patrimônio, Relatórios, Conhecimento, Minha conta e Administração autorizada.
- Realizado, Programado, Projetado, Previsão e resultado esperado.
- Cartão e parcela no mês correto, recorrência antes do pagamento, reconciliação sem duplicidade, cancelamento, investimento e cores de categoria.
- Accordions, filtros, ações simuladas, estados vazio/erro, foco, ARIA, alvos de toque, overflow e geometria do header.
- Lifecycle real de Chart.js com a mesma versão do app, servida localmente para não depender de CDN.
- Bloqueio de toda requisição externa e de todo método HTTP de escrita.

## Executar localmente

```bash
npm ci
./node_modules/.bin/playwright install chromium webkit firefox
npm run test:e2e
```

Para uma iteração rápida:

```bash
npm run test:e2e:chromium
```

O servidor estático é iniciado e encerrado pelo Playwright na porta `4173` por padrão. Use `E2E_PORT` para escolher outra porta. Contextos, storage, IndexedDB, caches e service workers são isolados a cada teste; a fixture original é congelada e recriada por cenário.

## Evidências e execução diária

O workflow `.github/workflows/aviora-e2e-daily.yml` roda Chromium em pull requests e as três engines no agendamento diário ou disparo manual. Não recebe secrets, possui apenas `contents: read`, guarda o relatório por sete dias e envia traces/screenshots sintéticos somente quando há falha.

As comparações visuais usam estrutura, geometria e semântica acessível em vez de pixel-perfect frágil entre sistemas operacionais. O Playwright captura screenshot e trace da tela que falhou.

## Limites honestos

- O login é uma simulação local; Auth, RLS e permissões reais continuam cobertos por seus testes próprios e pelo smoke controlado em Beta.
- Safe-area física, barras móveis, teclado virtual e percepção visual final ainda exigem dispositivo real.
- O preview usa a mesma versão de Chart.js do app, mas não testa disponibilidade, cache ou falhas da CDN de produção.
- Ações de pagamento, edição e exclusão são simuladas e não persistem dados.
