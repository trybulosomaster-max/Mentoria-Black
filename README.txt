MENTORIA BLACK — V46
CONSOLIDAÇÃO FUNCIONAL

Base: V44 funcional.

A V46 foi construída preservando o núcleo completo da V44 e consolidando as camadas
que eram deliberadamente sobrepostas:

- dashboardBase -> única window.dashboard final;
- openRecurringBase -> única window.openRecurring final;
- openTransactionBase -> única window.openTransaction final;
- bindFiltersBase -> única window.bindFilters final;
- removido o wrapper V44 redundante;
- removido o wrapper no-op de drawCharts;
- removidos encadeamentos oldOpen / oldDashboard / previousBind / oldRecurring;
- categorias ficam com uma única implementação pública final;
- Service Worker único V46.

Não houve alteração/migração no Supabase.
Não criar nova camada sobre a V46: futuras alterações devem editar a implementação consolidada.
