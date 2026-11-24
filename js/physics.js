window.WB = window.WB || {};

// Полная база формул Кодификатора ФИПИ ЕГЭ 2027 по ФИЗИКЕ (проект от 20.08.2026)
// Каждая формула перенесена точь-в-точь из раздела 2 (Таблица 3) кодификатора 2027 года.
WB.PHYSICS_SECTIONS = [
  {
    id: 'fav',
    title: 'Избранное',
    subtopics: [{ id: 'all', title: 'Все сохранённые' }]
  },
  {
    id: 'mech',
    title: '1. Механика',
    subtopics: [
      { id: 'all', title: 'Все темы' },
      { id: '1.1', title: '1.1 Кинематика' },
      { id: '1.2', title: '1.2 Динамика' },
      { id: '1.3', title: '1.3 Статика' },
      { id: '1.4', title: '1.4 Законы сохранения' },
      { id: '1.5', title: '1.5 Колебания и волны' }
    ]
  },
  {
    id: 'mkt',
    title: '2. МКТ и Термодинамика',
    subtopics: [
      { id: 'all', title: 'Все темы' },
      { id: '2.1', title: '2.1 Молекулярная физика' },
      { id: '2.2', title: '2.2 Термодинамика' }
    ]
  },
  {
    id: 'electro',
    title: '3. Электродинамика и Оптика',
    subtopics: [
      { id: 'all', title: 'Все темы' },
      { id: '3.1', title: '3.1 Электрическое поле' },
      { id: '3.2', title: '3.2 Постоянный ток' },
      { id: '3.3', title: '3.3 Магнитное поле' },
      { id: '3.4', title: '3.4 ЭМ индукция' },
      { id: '3.5', title: '3.5 ЭМ колебания и волны' },
      { id: '3.6', title: '3.6 Оптика' }
    ]
  },
  {
    id: 'quant',
    title: '4. Квантовая физика',
    subtopics: [
      { id: 'all', title: 'Все темы' },
      { id: '4.1', title: '4.1 Фотоны и фотоэффект' },
      { id: '4.2', title: '4.2 Физика атома' },
      { id: '4.3', title: '4.3 Атомное ядро' }
    ]
  }
];

WB.PHYSICS_FORMULAS = [
  // --- 1.1 КИНЕМАТИКА ---
  {
    code: '1.1.2',
    section: 'mech',
    subtopic: '1.1',
    title: 'Радиус-вектор, перемещение и сложение перемещений',
    latex: '\\vec{r}(t) = (x(t), y(t), z(t)), \\quad \\Delta\\vec{r} = \\vec{r}(t_2) - \\vec{r}(t_1) = \\vec{r}_2 - \\vec{r}_1 = (\\Delta x, \\Delta y, \\Delta z), \\quad \\Delta\\vec{r}_1 = \\Delta\\vec{r}_2 + \\Delta\\vec{r}_0',
    hint: 'Материальная точка, радиус-вектор, перемещение, сложение перемещений',
    keywords: 'перемещение радиус вектор траектория кинематика'
  },
  {
    code: '1.1.3',
    section: 'mech',
    subtopic: '1.1',
    title: 'Скорость материальной точки и сложение скоростей',
    latex: '\\vec{v} = \\left.\\frac{\\Delta\\vec{r}}{\\Delta t}\\right|_{\\Delta t \\to 0} = \\vec{r}\'_t = (v_x, v_y, v_z), \\quad v_x = \\left.\\frac{\\Delta x}{\\Delta t}\\right|_{\\Delta t \\to 0} = x\'_t, \\; v_y = y\'_t, \\; v_z = z\'_t, \\quad \\vec{v}_1 = \\vec{v}_2 + \\vec{v}_0',
    hint: 'Мгновенная скорость, проекции и сложение скоростей',
    keywords: 'скорость сложение скоростей производная проекция'
  },
  {
    code: '1.1.4',
    section: 'mech',
    subtopic: '1.1',
    title: 'Ускорение материальной точки',
    latex: '\\vec{a} = \\left.\\frac{\\Delta\\vec{v}}{\\Delta t}\\right|_{\\Delta t \\to 0} = \\vec{v}\'_t = (a_x, a_y, a_z), \\quad a_x = \\left.\\frac{\\Delta v_x}{\\Delta t}\\right|_{\\Delta t \\to 0} = (v_x)\'_t, \\; a_y = (v_y)\'_t, \\; a_z = (v_z)\'_t',
    hint: 'Вектор ускорения и проекции ускорения на оси координат',
    keywords: 'ускорение проекция производная скорости'
  },
  {
    code: '1.1.5',
    section: 'mech',
    subtopic: '1.1',
    title: 'Равномерное прямолинейное движение',
    latex: 'x(t) = x_0 + v_{0x}t, \\quad v_x(t) = v_{0x} = \\text{const}',
    hint: 'Координата и скорость при равномерном прямолинейном движении',
    keywords: 'равномерное прямолинейное движение координата'
  },
  {
    code: '1.1.6',
    section: 'mech',
    subtopic: '1.1',
    title: 'Равноускоренное прямолинейное движение',
    latex: 'x(t) = x_0 + v_{0x}t + \\frac{a_x t^2}{2}, \\quad v_x(t) = v_{0x} + a_x t, \\quad a_x = \\text{const}',
    hint: 'Координата, скорость и постоянное ускорение',
    keywords: 'равноускоренное движение ускорение координата время'
  },
  {
    code: '1.1.6б',
    section: 'mech',
    subtopic: '1.1',
    title: 'Связь скоростей без времени и путь при движении в одном направлении',
    latex: 'v_{2x}^2 - v_{1x}^2 = 2a_x(x_2 - x_1), \\quad S = \\frac{v_1 + v_2}{2}\\cdot t',
    hint: 'Безвременная формула и путь через среднюю скорость',
    keywords: 'путь без времени квадраты скоростей средняя скорость'
  },
  {
    code: '1.1.7',
    section: 'mech',
    subtopic: '1.1',
    title: 'Свободное падение и движение тела под углом α к горизонту',
    latex: '\\begin{cases} x(t) = x_0 + v_{0x}t = x_0 + v_0\\cos\\alpha\\cdot t \\\\ y(t) = y_0 + v_{0y}t + \\frac{g_y t^2}{2} = y_0 + v_0\\sin\\alpha\\cdot t - \\frac{gt^2}{2} \\end{cases}, \\; \\begin{cases} v_x(t) = v_{0x} = v_0\\cos\\alpha \\\\ v_y(t) = v_{0y} + g_y t = v_0\\sin\\alpha - gt \\end{cases}, \\; \\begin{cases} g_x = 0 \\\\ g_y = -g = \\text{const} \\end{cases}',
    hint: 'Уравнения координат, скоростей и ускорения свободного падения',
    keywords: 'свободное падение баллистика бросок под углом горизонт g'
  },
  {
    code: '1.1.8',
    section: 'mech',
    subtopic: '1.1',
    title: 'Движение по окружности и центростремительное ускорение',
    latex: 'v = \\omega R, \\quad \\omega = \\frac{2\\pi}{T}, \\quad \\omega = 2\\pi\\nu, \\quad T = \\frac{2\\pi R}{v}, \\quad a_{\\text{цс}} = \\frac{v^2}{R}, \\quad a_{\\text{цс}} = \\omega^2 R',
    hint: 'Угловая и линейная скорость, период, частота, центростремительное ускорение',
    keywords: 'окружность криволинейное центростремительное угловая скорость период'
  },

  // --- 1.2 ДИНАМИКА ---
  {
    code: '1.2.2',
    section: 'mech',
    subtopic: '1.2',
    title: 'Плотность вещества',
    latex: '\\rho = \\frac{m}{V}',
    hint: 'Масса тела и плотность вещества',
    keywords: 'плотность масса объем'
  },
  {
    code: '1.2.3',
    section: 'mech',
    subtopic: '1.2',
    title: 'Принцип суперпозиции сил',
    latex: '\\vec{F}_{\\text{равнодейств}} = \\vec{F}_1 + \\vec{F}_2 + \\dots',
    hint: 'Равнодействующая нескольких сил равна их векторной сумме',
    keywords: 'сила суперпозиция равнодействующая'
  },
  {
    code: '1.2.4',
    section: 'mech',
    subtopic: '1.2',
    title: 'Второй закон Ньютона (в ИСО)',
    latex: '\\vec{F} = m\\vec{a}; \\quad \\Delta\\vec{p} = \\vec{F}\\Delta t \\;\\text{при}\\; \\vec{F} = \\text{const}',
    hint: 'Для материальной точки в ИСО: классическая и импульсная формы',
    keywords: 'второй закон ньютона сила масса ускорение импульс'
  },
  {
    code: '1.2.5',
    section: 'mech',
    subtopic: '1.2',
    title: 'Третий закон Ньютона для материальных точек',
    latex: '\\vec{F}_{12} = -\\vec{F}_{21}',
    hint: 'Силы взаимодействия равны по модулю и противоположны по направлению',
    keywords: 'третий закон ньютона взаимодействие'
  },
  {
    code: '1.2.6',
    section: 'mech',
    subtopic: '1.2',
    title: 'Закон всемирного тяготения и сила тяжести на высоте h',
    latex: 'F = G\\frac{m_1 m_2}{R^2}, \\quad mg = \\frac{GMm}{(R_0 + h)^2}',
    hint: 'Модуль сил притяжения и зависимость силы тяжести от высоты h над планетой радиуса R0',
    keywords: 'тяготение гравитация сила тяжести ньютон высота планета'
  },
  {
    code: '1.2.7',
    section: 'mech',
    subtopic: '1.2',
    title: 'Сила упругости. Закон Гука',
    latex: 'F_x = -kx',
    hint: 'Проекция силы упругости прямо пропорциональна удлинению x',
    keywords: 'гук упругость пружина жесткость'
  },
  {
    code: '1.2.8',
    section: 'mech',
    subtopic: '1.2',
    title: 'Сила трения скольжения и сила трения покоя',
    latex: 'F_{\\text{тр}} = \\mu N, \\quad F_{\\text{тр}} \\le \\mu N',
    hint: 'Сухое трение: скольжения (μN) и покоя (≤ μN)',
    keywords: 'трение скольжение покой коэффициент реакция опоры'
  },
  {
    code: '1.2.9',
    section: 'mech',
    subtopic: '1.2',
    title: 'Давление',
    latex: 'p = \\frac{F_{\\perp}}{S}',
    hint: 'Отношение перпендикулярной составляющей силы к площади S',
    keywords: 'давление площадь сила паскаль'
  },

  // --- 1.3 СТАТИКА ---
  {
    code: '1.3.1',
    section: 'mech',
    subtopic: '1.3',
    title: 'Момент силы относительно оси вращения',
    latex: '|M| = Fl',
    hint: 'l — плечо силы F относительно оси вращения',
    keywords: 'момент силы плечо статика рычаг'
  },
  {
    code: '1.3.2',
    section: 'mech',
    subtopic: '1.3',
    title: 'Центр масс системы материальных точек',
    latex: '\\vec{r}_{\\text{ц.м.}} = \\frac{m_1\\vec{r}_1 + m_2\\vec{r}_2 + \\dots}{m_1 + m_2 + \\dots}',
    hint: 'В однородном поле тяжести (g = const) совпадает с центром тяжести',
    keywords: 'центр масс центр тяжести'
  },
  {
    code: '1.3.3',
    section: 'mech',
    subtopic: '1.3',
    title: 'Условия равновесия твёрдого тела в ИСО',
    latex: '\\begin{cases} M_1 + M_2 + \\dots = 0 \\\\ \\vec{F}_1 + \\vec{F}_2 + \\dots = 0 \\end{cases}',
    hint: 'Сумма моментов сил и векторная сумма всех сил равны нулю',
    keywords: 'условия равновесия твердое тело моменты силы'
  },
  {
    code: '1.3.5',
    section: 'mech',
    subtopic: '1.3',
    title: 'Давление в жидкости, покоящейся в ИСО',
    latex: 'p = p_0 + \\rho gh',
    hint: 'p0 — внешнее (атмосферное) давление, ρ — плотность жидкости, h — глубина',
    keywords: 'давление жидкости гидростатика глубина'
  },
  {
    code: '1.3.6',
    section: 'mech',
    subtopic: '1.3',
    title: 'Закон Архимеда',
    latex: '\\vec{F}_{\\text{Арх}} = -\\vec{P}_{\\text{вытесн}}, \\quad F_{\\text{Арх}} = \\rho g V_{\\text{вытесн}}',
    hint: 'Если тело и жидкость покоятся в ИСО: F_Арх = ρgV_вытесн',
    keywords: 'архимед выталкивающая сила плавание тел'
  },

  // --- 1.4 ЗАКОНЫ СОХРАНЕНИЯ В МЕХАНИКЕ ---
  {
    code: '1.4.1',
    section: 'mech',
    subtopic: '1.4',
    title: 'Импульс материальной точки',
    latex: '\\vec{p} = m\\vec{v}',
    hint: 'Произведение массы материальной точки на её скорость',
    keywords: 'импульс материальная точка скорость'
  },
  {
    code: '1.4.2',
    section: 'mech',
    subtopic: '1.4',
    title: 'Импульс системы тел',
    latex: '\\vec{p} = \\vec{p}_1 + \\vec{p}_2 + \\dots',
    hint: 'Векторная сумма импульсов всех тел системы',
    keywords: 'импульс системы тел'
  },
  {
    code: '1.4.3',
    section: 'mech',
    subtopic: '1.4',
    title: 'Закон изменения и сохранения импульса (в ИСО)',
    latex: '\\Delta\\vec{p} \\equiv \\Delta(\\vec{p}_1 + \\vec{p}_2 + \\dots) = \\vec{F}_{1\\text{ внешн}}\\Delta t + \\vec{F}_{2\\text{ внешн}}\\Delta t + \\dots; \\quad \\Delta\\vec{p} \\equiv \\Delta(\\vec{p}_1 + \\vec{p}_2 + \\dots) = 0 \\;(\\text{если } \\vec{F}_{1\\text{ внешн}} + \\vec{F}_{2\\text{ внешн}} + \\dots = 0)',
    hint: 'Закон изменения и сохранения импульса системы в ИСО',
    keywords: 'закон сохранения импульса изменение внешние силы реактивное'
  },
  {
    code: '1.4.4',
    section: 'mech',
    subtopic: '1.4',
    title: 'Работа силы на малом перемещении',
    latex: 'A = |\\vec{F}|\\cdot|\\Delta\\vec{r}|\\cdot\\cos\\alpha = F_x \\cdot \\Delta x',
    hint: 'α — угол между векторами силы и малого перемещения',
    keywords: 'работа силы перемещение косинус проекция'
  },
  {
    code: '1.4.5',
    section: 'mech',
    subtopic: '1.4',
    title: 'Мощность силы',
    latex: 'P = \\left.\\frac{\\Delta A}{\\Delta t}\\right|_{\\Delta t \\to 0} = F\\cdot v\\cdot\\cos\\alpha',
    hint: 'Мгновенная мощность силы',
    keywords: 'мощность работа скорость косинус'
  },
  {
    code: '1.4.6',
    section: 'mech',
    subtopic: '1.4',
    title: 'Кинетическая энергия и теорема о кинетической энергии',
    latex: 'E_{\\text{кин}} = \\frac{mv^2}{2}; \\quad E_{\\text{кин}} = \\frac{p^2}{2m}; \\quad \\Delta E_{\\text{кин}} = A_1 + A_2 + \\dots',
    hint: 'Теорема об изменении кинетической энергии системы материальных точек в ИСО',
    keywords: 'кинетическая энергия теорема импульс работа'
  },
  {
    code: '1.4.7',
    section: 'mech',
    subtopic: '1.4',
    title: 'Потенциальная энергия (тяжести и упругой деформации)',
    latex: 'A_{12} = E_{1\\text{ потенц}} - E_{2\\text{ потенц}} = -\\Delta E_{\\text{потенц}}, \\quad E_{\\text{потенц}} = mgh, \\quad E_{\\text{потенц}} = \\frac{kx^2}{2}',
    hint: 'Работа потенциальных сил, энергия в поле тяжести и упруго деформированного тела',
    keywords: 'потенциальная энергия mgh kx2 пружина тяжесть'
  },
  {
    code: '1.4.8',
    section: 'mech',
    subtopic: '1.4',
    title: 'Закон изменения и сохранения механической энергии',
    latex: 'E_{\\text{мех}} = E_{\\text{кин}} + E_{\\text{потенц}}, \\quad \\Delta E_{\\text{мех}} = A_{\\text{всех непотенц. сил}}, \\quad \\Delta E_{\\text{мех}} = 0 \\;(\\text{если } A_{\\text{всех непотенц. сил}} = 0)',
    hint: 'Полная механическая энергия и её сохранение при отсутствии работы непотенциальных сил',
    keywords: 'закон сохранения механической энергии непотенциальные силы'
  },

  // --- 1.5 МЕХАНИЧЕСКИЕ КОЛЕБАНИЯ И ВОЛНЫ ---
  {
    code: '1.5.1',
    section: 'mech',
    subtopic: '1.5',
    title: 'Гармонические колебания (кинематическое описание)',
    latex: 'x(t) = A\\sin(\\omega t + \\varphi_0), \\quad v_x(t) = x\'_t, \\quad a_x(t) = (v_x)\'_t = -\\omega^2 x(t) \\Rightarrow a_x + \\omega^2 x = 0',
    hint: 'Амплитуда, фаза колебаний, скорость, ускорение и дифференциальное уравнение',
    keywords: 'гармонические колебания амплитуда фаза синус уравнение'
  },
  {
    code: '1.5.1б',
    section: 'mech',
    subtopic: '1.5',
    title: 'Динамика, энергия и амплитуды гармонических колебаний',
    latex: 'ma_x = -kx \\;(k = m\\omega^2), \\quad \\frac{mv^2}{2} + \\frac{kx^2}{2} = \\frac{mv_{\\max}^2}{2} = \\frac{kA^2}{2} = \\text{const}, \\quad v_{\\max} = \\omega A, \\; a_{\\max} = \\omega^2 A, \\; a_{\\max} = \\omega v_{\\max}',
    hint: 'Энергетическое описание и связь амплитуд смещения, скорости и ускорения',
    keywords: 'колебания энергия амплитуда максимальная скорость ускорение'
  },
  {
    code: '1.5.2',
    section: 'mech',
    subtopic: '1.5',
    title: 'Период, частота и циклические частоты маятников',
    latex: 'T = \\frac{2\\pi}{\\omega}, \\quad T = \\frac{1}{\\nu}, \\quad T = 2\\pi\\sqrt{\\frac{l}{g}}, \\quad T = 2\\pi\\sqrt{\\frac{m}{k}}, \\quad \\omega = \\sqrt{\\frac{g}{l}}, \\quad \\omega = \\sqrt{\\frac{k}{m}}',
    hint: 'Период и циклическая частота математического и пружинного маятников',
    keywords: 'маятник математический пружинный период частота циклическая'
  },
  {
    code: '1.5.4',
    section: 'mech',
    subtopic: '1.5',
    title: 'Скорость распространения и длина волны',
    latex: '\\lambda = vT, \\quad \\lambda = \\frac{v}{\\nu}',
    hint: 'Поперечные и продольные волны',
    keywords: 'волна длина волны скорость период частота'
  },

  // --- 2.1 МОЛЕКУЛЯРНАЯ ФИЗИКА ---
  {
    code: '2.1.1',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Количество вещества',
    latex: '\\nu = \\frac{N}{N_A}, \\quad \\nu = \\frac{m}{\\mu}',
    hint: 'NA — число Авогадро, m — масса тела, μ — молярная масса вещества',
    keywords: 'количество вещества моль авогадро молярная масса'
  },
  {
    code: '2.1.6',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Основное уравнение МКТ идеального газа',
    latex: 'p = \\frac{1}{3}m_0 n\\overline{v^2}, \\quad p = \\frac{2}{3}n\\overline{\\left(\\frac{m_0 v^2}{2}\\right)}, \\quad p = \\frac{2}{3}n\\cdot\\overline{\\varepsilon_{\\text{пост}}}, \\quad m_0 = \\frac{\\mu}{N_A}, \\quad n = \\frac{N}{V}',
    hint: 'Связь давления со средней кинетической энергией, масса молекулы и концентрация',
    keywords: 'основное уравнение мкт давление молекула концентрация'
  },
  {
    code: '2.1.7',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Абсолютная температура',
    latex: 'T = t^\\circ + 273\\text{ К}',
    hint: 'Шкала Кельвина',
    keywords: 'абсолютная температура кельвин цельсий'
  },
  {
    code: '2.1.8',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Связь температуры со средней кинетической энергией молекул',
    latex: '\\overline{\\varepsilon_{\\text{пост}}} = \\overline{\\left(\\frac{m_0 v^2}{2}\\right)}, \\quad \\overline{\\varepsilon_{\\text{пост}}} = \\frac{3}{2}kT',
    hint: 'Поступательное тепловое движение молекул газа',
    keywords: 'больцман средняя кинетическая энергия температура'
  },
  {
    code: '2.1.9',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Уравнение связи давления, концентрации и температуры',
    latex: 'p = nkT',
    hint: 'Давление идеального газа через концентрацию n и температуру T',
    keywords: 'давление концентрация больцман температура nkT'
  },
  {
    code: '2.1.10',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Уравнение Менделеева — Клапейрона и уравнение Клапейрона',
    latex: 'pV = \\frac{m}{\\mu}RT, \\quad pV = \\nu RT, \\quad pV = NkT, \\quad p = \\frac{\\rho RT}{\\mu}, \\quad \\frac{pV}{T} = \\text{const} \\;(\\text{при } \\nu = \\text{const})',
    hint: 'Все применимые формы записи уравнения состояния идеального газа',
    keywords: 'менделеев клапейрон идеальный газ уравнение состояния'
  },
  {
    code: '2.1.10б',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Внутренняя энергия одноатомного идеального газа',
    latex: 'U = \\frac{3}{2}\\nu RT, \\quad U = \\frac{3}{2}NkT, \\quad U = \\frac{3}{2}\\frac{m}{\\mu}RT, \\quad U = \\nu c_v T, \\quad U = \\frac{3}{2}pV',
    hint: 'Все 5 применимых форм записи из кодификатора 2027 (включая U = ν c_v T)',
    keywords: 'внутренняя энергия одноатомный газ теплоемкость cv'
  },
  {
    code: '2.1.11',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Закон Дальтона для давления смеси разреженных газов',
    latex: 'p = p_1 + p_2 + \\dots',
    hint: 'Давление смеси равно сумме парциальных давлений газов',
    keywords: 'дальтон парциальное давление смесь газов'
  },
  {
    code: '2.1.12',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Изопроцессы в разреженном газе (ν = const)',
    latex: 'pV = \\text{const} \\;(T = \\text{const}), \\quad \\frac{p}{T} = \\text{const} \\;(V = \\text{const}), \\quad \\frac{V}{T} = \\text{const} \\;(p = \\text{const})',
    hint: 'Изотерма (T = const), изохора (V = const), изобара (p = const)',
    keywords: 'изопроцессы изотерма изохора изобара'
  },
  {
    code: '2.1.14',
    section: 'mkt',
    subtopic: '2.1',
    title: 'Относительная влажность воздуха',
    latex: '\\varphi = \\frac{p_{\\text{пара}}(T)}{p_{\\text{насыщ.пара}}(T)}, \\quad \\varphi = \\frac{\\rho_{\\text{пара}}(T)}{\\rho_{\\text{насыщ.пара}}(T)}',
    hint: 'Отношение давления (плотности) пара к давлению (плотности) насыщенного пара при T',
    keywords: 'влажность воздуха насыщенный пар давление плотность'
  },

  // --- 2.2 ТЕРМОДИНАМИКА ---
  {
    code: '2.2.4',
    section: 'mkt',
    subtopic: '2.2',
    title: 'Количество теплоты и удельная теплоёмкость c',
    latex: 'Q = cm\\Delta T',
    hint: 'Теплота нагревания или охлаждения вещества',
    keywords: 'количество теплоты удельная теплоемкость нагревание'
  },
  {
    code: '2.2.5',
    section: 'mkt',
    subtopic: '2.2',
    title: 'Удельная теплота парообразования, плавления и сгорания',
    latex: 'Q = Lm, \\quad Q = \\lambda m, \\quad Q = qm',
    hint: 'L — парообразование, λ — плавление, q — сгорание топлива',
    keywords: 'парообразование плавление сгорание топлива фазовый переход'
  },
  {
    code: '2.2.6',
    section: 'mkt',
    subtopic: '2.2',
    title: 'Элементарная работа в термодинамике',
    latex: 'A = p\\Delta V',
    hint: 'Работа газа при малом изменении объёма',
    keywords: 'работа газа термодинамика объем давление'
  },
  {
    code: '2.2.7',
    section: 'mkt',
    subtopic: '2.2',
    title: 'Первый закон термодинамики и адиабата',
    latex: 'Q_{12} = \\Delta U_{12} + A_{12} = (U_2 - U_1) + A_{12}; \\quad Q_{12} = 0 \\Rightarrow A_{12} = U_1 - U_2 = -\\Delta U_{12}',
    hint: 'Первый закон термодинамики и уравнение работы при адиабатном процессе',
    keywords: 'первый закон термодинамики адиабата внутренняя энергия'
  },
  {
    code: '2.2.9',
    section: 'mkt',
    subtopic: '2.2',
    title: 'КПД тепловых машин',
    latex: '\\eta = \\frac{A_{\\text{за цикл}}}{Q_{\\text{нагр}}}, \\quad \\eta = \\frac{Q_{\\text{нагр}} - |Q_{\\text{хол}}|}{Q_{\\text{нагр}}}, \\quad \\eta = 1 - \\frac{|Q_{\\text{хол}}|}{Q_{\\text{нагр}}}',
    hint: 'Коэффициент полезного действия теплового двигателя',
    keywords: 'кпд тепловая машина нагреватель холодильник'
  },
  {
    code: '2.2.10',
    section: 'mkt',
    subtopic: '2.2',
    title: 'Максимальное значение КПД. Цикл Карно',
    latex: '\\max\\eta = \\eta_{\\text{Карно}} = \\frac{T_{\\text{нагр}} - T_{\\text{хол}}}{T_{\\text{нагр}}}, \\quad \\max\\eta = \\eta_{\\text{Карно}} = 1 - \\frac{T_{\\text{хол}}}{T_{\\text{нагр}}}',
    hint: 'КПД идеальной тепловой машины Карно',
    keywords: 'карно максимальный кпд цикл карно температура'
  },
  {
    code: '2.2.11',
    section: 'mkt',
    subtopic: '2.2',
    title: 'Уравнение теплового баланса',
    latex: 'Q_1 + Q_2 + Q_3 + \\dots = 0',
    hint: 'Сумма количеств теплоты в теплоизолированной системе равна нулю',
    keywords: 'тепловой баланс калориметр теплообмен'
  },

  // --- 3.1 ЭЛЕКТРИЧЕСКОЕ ПОЛЕ ---
  {
    code: '3.1.2',
    section: 'electro',
    subtopic: '3.1',
    title: 'Закон Кулона',
    latex: 'F = k\\frac{|q_1|\\cdot|q_2|}{\\varepsilon r^2}, \\quad F = \\frac{1}{4\\pi\\varepsilon_0}\\cdot\\frac{|q_1|\\cdot|q_2|}{r^2}',
    hint: 'Взаимодействие точечных зарядов в однородном диэлектрике и вакууме',
    keywords: 'закон кулона заряд диэлектрическая проницаемость'
  },
  {
    code: '3.1.4',
    section: 'electro',
    subtopic: '3.1',
    title: 'Напряжённость электрического поля и поле точечного заряда',
    latex: '\\vec{E} = \\frac{\\vec{F}}{q_{\\text{пробный}}}, \\quad E_r = k\\frac{q}{r^2}, \\quad \\vec{E} = \\text{const}',
    hint: 'Определение напряжённости, радиальная компонента поля заряда, однородное поле',
    keywords: 'напряженность электрическое поле точечный заряд пробный'
  },
  {
    code: '3.1.5',
    section: 'electro',
    subtopic: '3.1',
    title: 'Потенциал, напряжение, работа поля и связь E с U',
    latex: 'A_{12} = q(\\varphi_1 - \\varphi_2), \\; A_{12} = -q\\Delta\\varphi, \\; A_{12} = qU, \\; W = q\\varphi, \\; A = -\\Delta W, \\; \\varphi = \\frac{W}{q}, \\; U = Ed',
    hint: 'Потенциальность электростатического поля и однородное поле U = Ed',
    keywords: 'потенциал напряжение разность потенциалов работа поля Ed'
  },
  {
    code: '3.1.6',
    section: 'electro',
    subtopic: '3.1',
    title: 'Принцип суперпозиции электрических полей',
    latex: '\\vec{E} = \\vec{E}_1 + \\vec{E}_2 + \\dots, \\quad \\varphi = \\varphi_1 + \\varphi_2 + \\dots',
    hint: 'Сложение напряжённостей (векторно) и потенциалов (алгебраически)',
    keywords: 'суперпозиция электрических полей потенциал напряженность'
  },
  {
    code: '3.1.7',
    section: 'electro',
    subtopic: '3.1',
    title: 'Проводники в электростатическом поле',
    latex: '\\vec{E} = 0 \\;(\\text{внутри проводника}), \\quad \\varphi = \\text{const}',
    hint: 'Условие равновесия зарядов внутри и на поверхности проводника',
    keywords: 'проводник электростатическое поле равновесие'
  },
  {
    code: '3.1.9',
    section: 'electro',
    subtopic: '3.1',
    title: 'Электроёмкость конденсатора (плоского и воздушного)',
    latex: 'C = \\frac{q}{U}, \\quad C = \\frac{\\varepsilon\\varepsilon_0 S}{d}, \\quad C = \\frac{\\varepsilon_0 S}{d}',
    hint: 'Ёмкость плоского конденсатора с диэлектриком ε и воздушного конденсатора',
    keywords: 'конденсатор электроемкость плоский воздушный'
  },
  {
    code: '3.1.10',
    section: 'electro',
    subtopic: '3.1',
    title: 'Параллельное и последовательное соединение конденсаторов',
    latex: 'q = q_1 + q_2 + \\dots, \\; U_1 = U_2 = \\dots, \\; C_{\\text{паралл}} = C_1 + C_2 + \\dots; \\quad U = U_1 + U_2 + \\dots, \\; q_1 = q_2 = \\dots, \\; \\frac{1}{C_{\\text{посл}}} = \\frac{1}{C_1} + \\frac{1}{C_2} + \\dots',
    hint: 'Законы для зарядов, напряжений и общей электроёмкости батареи конденсаторов',
    keywords: 'соединение конденсаторов параллельное последовательное'
  },
  {
    code: '3.1.11',
    section: 'electro',
    subtopic: '3.1',
    title: 'Энергия заряженного конденсатора',
    latex: 'W_C = \\frac{qU}{2}, \\quad W_C = \\frac{CU^2}{2}, \\quad W_C = \\frac{q^2}{2C}',
    hint: 'Все 3 формулы энергии электрического поля конденсатора',
    keywords: 'энергия конденсатора cu2 q2'
  },

  // --- 3.2 ЗАКОНЫ ПОСТОЯННОГО ТОКА ---
  {
    code: '3.2.1',
    section: 'electro',
    subtopic: '3.2',
    title: 'Сила тока и постоянный ток',
    latex: 'I = \\left.\\frac{\\Delta q}{\\Delta t}\\right|_{\\Delta t \\to 0}, \\quad I = \\text{const}, \\quad q = It',
    hint: 'Определение силы тока и заряд при постоянном токе',
    keywords: 'сила тока заряд постоянный ток'
  },
  {
    code: '3.2.3',
    section: 'electro',
    subtopic: '3.2',
    title: 'Закон Ома для участка цепи',
    latex: 'I = \\frac{U}{R}',
    hint: 'Сила тока прямо пропорциональна напряжению и обратно пропорциональна сопротивлению',
    keywords: 'закон ома участок цепи ток напряжение сопротивление'
  },
  {
    code: '3.2.4',
    section: 'electro',
    subtopic: '3.2',
    title: 'Электрическое сопротивление проводника',
    latex: 'R = \\rho\\frac{l}{S}',
    hint: 'ρ — удельное сопротивление вещества, l — длина, S — площадь сечения',
    keywords: 'сопротивление удельное длина сечение проводник'
  },
  {
    code: '3.2.5',
    section: 'electro',
    subtopic: '3.2',
    title: 'ЭДС источника тока',
    latex: '\\mathcal{E} = \\frac{A_{\\text{сторонних сил}}}{q}',
    hint: 'Отношение работы сторонних сил по перемещению заряда к величине заряда',
    keywords: 'эдс сторонние силы источник тока'
  },
  {
    code: '3.2.6',
    section: 'electro',
    subtopic: '3.2',
    title: 'Закон Ома для полной (замкнутой) электрической цепи',
    latex: '\\mathcal{E} = IR + Ir, \\quad I = \\frac{\\mathcal{E}}{R + r}',
    hint: 'R — сопротивление внешней цепи, r — внутреннее сопротивление источника',
    keywords: 'закон ома полная замкнутая цепь эдс внутреннее сопротивление'
  },
  {
    code: '3.2.7',
    section: 'electro',
    subtopic: '3.2',
    title: 'Параллельное и последовательное соединение проводников',
    latex: 'I = I_1 + I_2 + \\dots, \\; U_1 = U_2 = \\dots, \\; \\frac{1}{R_{\\text{паралл}}} = \\frac{1}{R_1} + \\frac{1}{R_2} + \\dots; \\quad U = U_1 + U_2 + \\dots, \\; I_1 = I_2 = \\dots, \\; R_{\\text{посл}} = R_1 + R_2 + \\dots',
    hint: 'Токи, напряжения и эквивалентные сопротивления',
    keywords: 'соединение проводников резисторов параллельное последовательное'
  },
  {
    code: '3.2.8',
    section: 'electro',
    subtopic: '3.2',
    title: 'Работа постоянного тока. Закон Джоуля — Ленца',
    latex: 'A = IUt, \\quad Q = I^2 Rt, \\quad Q = A = I^2 Rt, \\quad Q = A = IUt, \\quad Q = A = \\frac{U^2}{R}t',
    hint: 'Работа тока и теплота, выделяющаяся на резисторе R',
    keywords: 'работа тока джоуль ленц теплота резистор'
  },
  {
    code: '3.2.9',
    section: 'electro',
    subtopic: '3.2',
    title: 'Мощность электрического тока и мощность источника',
    latex: 'P = \\left.\\frac{\\Delta A}{\\Delta t}\\right|_{\\Delta t \\to 0} = IU, \\quad P = I^2 R, \\quad P = \\frac{U^2}{R}, \\quad P_{\\mathcal{E}} = \\left.\\frac{\\Delta A_{\\text{ст. сил}}}{\\Delta t}\\right|_{\\Delta t \\to 0} = \\mathcal{E}I',
    hint: 'Тепловая мощность на резисторе и полная мощность источника тока',
    keywords: 'мощность тока резистор источник эдс'
  },

  // --- 3.3 МАГНИТНОЕ ПОЛЕ ---
  {
    code: '3.3.1',
    section: 'electro',
    subtopic: '3.3',
    title: 'Принцип суперпозиции магнитных полей',
    latex: '\\vec{B} = \\vec{B}_1 + \\vec{B}_2 + \\dots',
    hint: 'Результирующий вектор магнитной индукции равен векторной сумме',
    keywords: 'магнитное поле индукция суперпозиция'
  },
  {
    code: '3.3.3',
    section: 'electro',
    subtopic: '3.3',
    title: 'Сила Ампера',
    latex: 'F_A = IBl\\sin\\alpha',
    hint: 'α — угол между направлением проводника с током и вектором B',
    keywords: 'сила ампера магнитная индукция проводник ток'
  },
  {
    code: '3.3.4',
    section: 'electro',
    subtopic: '3.3',
    title: 'Сила Лоренца',
    latex: 'F_{\\text{Лор}} = |q|vB\\sin\\alpha',
    hint: 'α — угол между векторами скорости v и магнитной индукции B',
    keywords: 'сила лоренца заряд скорость магнитное поле'
  },

  // --- 3.4 ЭЛЕКТРОМАГНИТНАЯ ИНДУКЦИЯ ---
  {
    code: '3.4.1',
    section: 'electro',
    subtopic: '3.4',
    title: 'Поток вектора магнитной индукции (магнитный поток)',
    latex: '\\Phi = B_n S = BS\\cos\\alpha',
    hint: 'α — угол между вектором магнитной индукции B и нормалью n к площадке S',
    keywords: 'магнитный поток индукция нормаль косинус'
  },
  {
    code: '3.4.3',
    section: 'electro',
    subtopic: '3.4',
    title: 'Закон электромагнитной индукции Фарадея',
    latex: '\\mathcal{E}_i = -\\left.\\frac{\\Delta\\Phi}{\\Delta t}\\right|_{\\Delta t \\to 0} = -\\Phi\'_t',
    hint: 'ЭДС индукции равна скорости изменения магнитного потока со знаком минус',
    keywords: 'закон фарадея электромагнитная индукция эдс поток'
  },
  {
    code: '3.4.4',
    section: 'electro',
    subtopic: '3.4',
    title: 'ЭДС индукции в прямом движущемся проводнике',
    latex: '|\\mathcal{E}_i| = Blv\\sin\\alpha, \\quad |\\mathcal{E}_i| = Blv \\;(\\text{если } \\vec{l} \\perp \\vec{B} \\text{ и } \\vec{v} \\perp \\vec{B})',
    hint: 'Проводник длиной l движется со скоростью v (v ⊥ l) в однородном поле B',
    keywords: 'эдс индукции движущийся проводник blv'
  },
  {
    code: '3.4.6',
    section: 'electro',
    subtopic: '3.4',
    title: 'Индуктивность и ЭДС самоиндукции',
    latex: 'L = \\frac{\\Phi}{I} \\;(\\Phi = LI), \\quad \\mathcal{E}_{si} = -L\\left.\\frac{\\Delta I}{\\Delta t}\\right|_{\\Delta t \\to 0} = -LI\'_t',
    hint: 'Индуктивность контура и закон самоиндукции',
    keywords: 'индуктивность самоиндукция катушка ток'
  },
  {
    code: '3.4.7',
    section: 'electro',
    subtopic: '3.4',
    title: 'Энергия магнитного поля катушки с током',
    latex: 'W_L = \\frac{LI^2}{2}, \\quad W_L = \\frac{\\Phi^2}{2L}',
    hint: 'Две эквивалентные формы записи энергии магнитного поля',
    keywords: 'энергия магнитного поля катушка индуктивность'
  },

  // --- 3.5 ЭЛЕКТРОМАГНИТНЫЕ КОЛЕБАНИЯ И ВОЛНЫ ---
  {
    code: '3.5.1',
    section: 'electro',
    subtopic: '3.5',
    title: 'Свободные ЭМ колебания в контуре и формула Томсона',
    latex: '\\begin{cases} q(t) = q_{\\max}\\sin(\\omega t + \\varphi_0) \\\\ I(t) = q\'_t = \\omega q_{\\max}\\cos(\\omega t + \\varphi_0) = I_{\\max}\\cos(\\omega t + \\varphi_0) \\end{cases}, \\; T = 2\\pi\\sqrt{LC}, \\; \\omega = \\frac{2\\pi}{T}, \\; \\omega = \\frac{1}{\\sqrt{LC}}, \\; q_{\\max} = \\frac{I_{\\max}}{\\omega}',
    hint: 'Колебательный контур, формула Томсона, связь амплитуд заряда и тока',
    keywords: 'колебательный контур томсон lc период частота заряд ток'
  },
  {
    code: '3.5.2',
    section: 'electro',
    subtopic: '3.5',
    title: 'Закон сохранения энергии в идеальном колебательном контуре',
    latex: '\\frac{CU^2}{2} + \\frac{LI^2}{2} = \\frac{CU_{\\max}^2}{2} = \\frac{LI_{\\max}^2}{2} = \\text{const}',
    hint: 'Сумма энергий электрического поля конденсатора и магнитного поля катушки постоянна',
    keywords: 'энергия колебательный контур сохранение'
  },
  {
    code: '3.5.5',
    section: 'electro',
    subtopic: '3.5',
    title: 'Взаимная ориентация векторов в электромагнитной волне',
    latex: '\\vec{E} \\perp \\vec{B} \\perp \\vec{c}',
    hint: 'Поперечность электромагнитной волны в вакууме',
    keywords: 'электромагнитная волна векторы вакуум'
  },

  // --- 3.6 ОПТИКА ---
  {
    code: '3.6.2',
    section: 'electro',
    subtopic: '3.6',
    title: 'Закон отражения света',
    latex: '\\alpha = \\beta',
    hint: 'Угол падения равен углу отражения',
    keywords: 'отражение света зеркало угол падения'
  },
  {
    code: '3.6.4',
    section: 'electro',
    subtopic: '3.6',
    title: 'Законы преломления света и показатели преломления',
    latex: 'n_1\\sin\\alpha = n_2\\sin\\beta, \\; n_{\\text{абс}} = \\frac{c}{v}, \\; n_{\\text{отн}} = \\frac{n_2}{n_1}, \\; n_{\\text{отн}} = \\frac{v_1}{v_2}, \\; \\nu_1 = \\nu_2, \\; n_1\\lambda_1 = n_2\\lambda_2',
    hint: 'Преломление, абсолютный и относительный показатели, частоты и длины волн на границе',
    keywords: 'преломление света снеллиус показатель длина волны частота'
  },
  {
    code: '3.6.5',
    section: 'electro',
    subtopic: '3.6',
    title: 'Предельный угол полного внутреннего отражения',
    latex: '\\sin\\alpha_{\\text{пр}} = \\frac{1}{n_{\\text{отн}}}, \\quad \\sin\\alpha_{\\text{пр}} = \\frac{n_2}{n_1}',
    hint: 'Полное внутреннее отражение при n2 < n1',
    keywords: 'полное внутреннее отражение предельный угол'
  },
  {
    code: '3.6.6',
    section: 'electro',
    subtopic: '3.6',
    title: 'Оптическая сила тонкой линзы',
    latex: 'D = \\frac{1}{F}',
    hint: 'Связь оптической силы D (дптр) и фокусного расстояния F (м)',
    keywords: 'оптическая сила линза фокус диоптрия'
  },
  {
    code: '3.6.7',
    section: 'electro',
    subtopic: '3.6',
    title: 'Формула тонкой линзы и увеличение линзы',
    latex: '\\frac{1}{d} + \\frac{1}{f} = \\frac{1}{F}, \\quad \\Gamma = \\frac{h}{H}, \\quad \\Gamma = \\frac{|f|}{d}, \\quad \\Gamma = \\frac{h}{H} < 1, \\; \\Gamma = \\frac{|f|}{d} < 1 \\;(D < 0 \\Rightarrow F = \\frac{1}{D} < 0)',
    hint: 'Формула тонкой линзы, линейное увеличение (в т.ч. для рассеивающей линзы)',
    keywords: 'тонкая линза увеличение фокус рассеивающая собирающая'
  },
  {
    code: '3.6.10',
    section: 'electro',
    subtopic: '3.6',
    title: 'Интерференция света (максимумы и минимумы)',
    latex: '\\Delta = 2m\\frac{\\lambda}{2}, \\quad \\Delta = (2m + 1)\\frac{\\lambda}{2}, \\quad m = 0, \\pm 1, \\pm 2, \\pm 3, \\dots',
    hint: 'Условия максимумов и минимумов от двух синфазных когерентных источников',
    keywords: 'интерференция когерентные максимум минимум разность хода'
  },
  {
    code: '3.6.11',
    section: 'electro',
    subtopic: '3.6',
    title: 'Дифракционная решётка (условие главных максимумов)',
    latex: 'd\\sin\\varphi_m = m\\lambda, \\quad m = 0, \\pm 1, \\pm 2, \\pm 3, \\dots',
    hint: 'При нормальном падении монохроматического света с длиной волны λ на решётку с периодом d',
    keywords: 'дифракционная решетка дифракция максимум период'
  },

  // --- 4.1 КОРПУСКУЛЯРНО-ВОЛНОВОЙ ДУАЛИЗМ ---
  {
    code: '4.1.1',
    section: 'quant',
    subtopic: '4.1',
    title: 'Гипотеза М. Планка о квантах. Формула Планка',
    latex: 'E = h\\nu',
    hint: 'Энергия кванта электромагнитного излучения',
    keywords: 'планк квант энергия частота'
  },
  {
    code: '4.1.2',
    section: 'quant',
    subtopic: '4.1',
    title: 'Фотоны. Энергия и импульс фотона',
    latex: 'E = h\\nu, \\quad E = \\frac{hc}{\\lambda}, \\quad E = pc, \\quad p = \\frac{E}{c}, \\quad p = \\frac{h\\nu}{c}, \\quad p = \\frac{h}{\\lambda}',
    hint: 'Все выражения для энергии и импульса фотона',
    keywords: 'фотон энергия импульс длина волны'
  },
  {
    code: '4.1.4',
    section: 'quant',
    subtopic: '4.1',
    title: 'Уравнение Эйнштейна для фотоэффекта',
    latex: 'E_{\\text{фотона}} = A_{\\text{выхода}} + E_{\\text{кин max}}, \\; E_{\\text{фотона}} = h\\nu = \\frac{hc}{\\lambda}, \\; A_{\\text{выхода}} = h\\nu_{\\text{кр}} = \\frac{hc}{\\lambda_{\\text{кр}}}, \\; E_{\\text{кин max}} = \\frac{mv_{\\max}^2}{2}, \\; E_{\\text{кин max}} = eU_{\\text{зап}}',
    hint: 'Уравнение Эйнштейна, работа выхода, красная граница и запирающее напряжение',
    keywords: 'фотоэффект эйнштейн работа выхода запирающее напряжение красная граница'
  },

  // --- 4.2 ФИЗИКА АТОМА ---
  {
    code: '4.2.2',
    section: 'quant',
    subtopic: '4.2',
    title: 'Постулаты Бора (переходы между уровнями энергии)',
    latex: 'h\\nu_{mn} = \\frac{hc}{\\lambda_{mn}}, \\quad h\\nu_{mn} = |E_n - E_m|',
    hint: 'Излучение и поглощение фотонов при переходе атома с одного уровня энергии на другой',
    keywords: 'бор постулаты фотон переход уровни энергии'
  },
  {
    code: '4.2.3',
    section: 'quant',
    subtopic: '4.2',
    title: 'Спектр уровней энергии атома водорода',
    latex: 'E_n = \\frac{-13{,}6\\text{ эВ}}{n^2}, \\quad n = 1, 2, 3, \\dots',
    hint: 'Линейчатые спектры, энергия стационарных состояний атома водорода',
    keywords: 'атом водорода уровни энергии линейчатый спектр'
  },

  // --- 4.3 ФИЗИКА АТОМНОГО ЯДРА ---
  {
    code: '4.3.2',
    section: 'quant',
    subtopic: '4.3',
    title: 'Радиоактивность (α-, электронный β- и позитронный β-распады)',
    latex: '{}_{Z}^{A}\\text{X} \\to {}_{Z-2}^{A-4}\\text{Y} + {}_{2}^{4}\\text{He}; \\quad {}_{Z}^{A}\\text{X} \\to {}_{Z+1}^{A}\\text{Y} + {}_{-1}^{0}e + \\tilde{\\nu}_e; \\quad {}_{Z}^{A}\\text{X} \\to {}_{Z-1}^{A}\\text{Y} + {}_{+1}^{0}\\tilde{e} + \\nu_e',
    hint: 'Альфа-распад, электронный β⁻-распад и позитронный β⁺-распад (Кодификатор 2027)',
    keywords: 'альфа бета распад позитронный электронный радиоактивность ядро'
  },
  {
    code: '4.3.3',
    section: 'quant',
    subtopic: '4.3',
    title: 'Закон радиоактивного распада',
    latex: 'N(t) = N_0 \\cdot 2^{-\\frac{t}{T}}, \\quad m(t) = m_0 \\cdot 2^{-\\frac{t}{T}}',
    hint: 'Число нераспавшихся ядер N(t) и масса радиоактивного вещества m(t)',
    keywords: 'радиоактивный распад период полураспада масса ядро'
  }
];

WB.physicsState = {
  activeSection: 'mech',
  activeSubtopic: 'all',
  searchQuery: '',
  favorites: new Set(JSON.parse(localStorage.getItem('wb_phys_favs') || '["1.2.4","2.1.10","2.1.10б","3.2.3","4.1.4","4.3.2"]'))
};

const PHYSICS_SECTION_ICONS = {
  fav: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  mech: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09c-.66 0-1.25.4-1.51 1z"/></svg>',
  mkt: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>',
  electro: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  quant: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9.5" ry="4"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(120 12 12)"/></svg>'
};

WB.splitLatexFormulaParts = function(latex) {
  const src = (latex || '').trim();
  if (!src) return [];
  const parts = [];
  let braceDepth = 0;
  let envDepth = 0;
  let buf = '';
  let i = 0;

  const flush = () => {
    const cleaned = buf.replace(/^\s*[,;]\s*/, '').replace(/\s*[,;]\s*$/, '').trim();
    if (cleaned) parts.push(cleaned);
    buf = '';
  };

  while (i < src.length) {
    if (src.startsWith('\\begin{', i)) {
      envDepth++;
      buf += '\\begin{';
      i += 7;
      continue;
    }
    if (src.startsWith('\\end{', i)) {
      const closeIdx = src.indexOf('}', i + 5);
      if (closeIdx !== -1) {
        buf += src.slice(i, closeIdx + 1);
        envDepth = Math.max(0, envDepth - 1);
        i = closeIdx + 1;
        if (braceDepth === 0 && envDepth === 0) {
          const betweenCases = src.slice(i).match(/^\s*[,;]?\s*(?:\\;|\\,|\\q?quad)?\s*(?=\\begin\{)/);
          if (betweenCases) {
            flush();
            i += betweenCases[0].length;
          }
        }
        continue;
      }
    }

    const ch = src[i];
    if (ch === '{' && src[i - 1] !== '\\') {
      braceDepth++;
      buf += ch;
      i++;
      continue;
    }
    if (ch === '}' && src[i - 1] !== '\\') {
      braceDepth = Math.max(0, braceDepth - 1);
      buf += ch;
      i++;
      continue;
    }

    if (braceDepth === 0 && envDepth === 0) {
      const sepMatch = src.slice(i).match(/^[,;]?\s*\\q?quad\b\s*/);
      if (sepMatch) {
        flush();
        i += sepMatch[0].length;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return parts.length > 0 ? parts : [src];
};

WB.formatFormulaCountRu = function(count) {
  const n = Math.max(0, Math.floor(count));
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} формул`;
  if (mod10 === 1) return `${n} формула`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} формулы`;
  return `${n} формул`;
};

WB.getPhysicsSubtopicName = function(sectionId, subtopicId) {
  const sec = WB.PHYSICS_SECTIONS.find(s => s.id === sectionId);
  if (!sec) return '';
  const sub = sec.subtopics.find(st => st.id === subtopicId);
  if (!sub) return '';
  return sub.title.replace(/^\d+\.\d+\s+/, '');
};

WB.savePhysicsFavs = function() {
  try {
    localStorage.setItem('wb_phys_favs', JSON.stringify(Array.from(WB.physicsState.favorites)));
  } catch (e) {}
};

WB.togglePhysicsFav = function(code, event) {
  if (event) event.stopPropagation();
  if (WB.physicsState.favorites.has(code)) {
    WB.physicsState.favorites.delete(code);
  } else {
    WB.physicsState.favorites.add(code);
  }
  WB.savePhysicsFavs();
  WB.renderPhysicsTabs();
  WB.renderPhysicsCatalog();
};

WB.openPhysicsModal = function() {
  WB.closeAllDropdowns();
  const modal = document.getElementById('physicsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  WB.renderPhysicsTabs();
  WB.renderPhysicsCatalog();
  const searchInput = document.getElementById('physicsSearchInput');
  if (searchInput && window.innerWidth > 768) {
    setTimeout(() => searchInput.focus(), 60);
  }
};

WB.closePhysicsModal = function() {
  const modal = document.getElementById('physicsModal');
  if (modal) modal.style.display = 'none';
};

WB.setPhysicsSection = function(sectionId) {
  WB.physicsState.activeSection = sectionId;
  WB.physicsState.activeSubtopic = 'all';
  const searchInput = document.getElementById('physicsSearchInput');
  if (searchInput && searchInput.value.trim()) {
    searchInput.value = '';
    WB.physicsState.searchQuery = '';
  }
  WB.renderPhysicsTabs();
  WB.renderPhysicsCatalog();
  const grid = document.getElementById('physicsFormulasGrid');
  if (grid) grid.scrollTop = 0;
};

WB.setPhysicsSubtopic = function(subId) {
  WB.physicsState.activeSubtopic = subId;
  WB.renderPhysicsTabs();
  WB.renderPhysicsCatalog();
  const grid = document.getElementById('physicsFormulasGrid');
  if (grid) grid.scrollTop = 0;
};

WB.onPhysicsSearch = function(val) {
  WB.physicsState.searchQuery = val || '';
  WB.renderPhysicsTabs();
  WB.renderPhysicsCatalog();
};
WB.onPhysicsSearchInput = WB.onPhysicsSearch;

WB.clearPhysicsSearch = function() {
  WB.physicsState.searchQuery = '';
  const searchInput = document.getElementById('physicsSearchInput');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  WB.renderPhysicsTabs();
  WB.renderPhysicsCatalog();
};

WB.insertPhysicsFormula = function(latex, title, code) {
  const includeTitle = document.getElementById('physIncludeTitleCheckbox')?.checked ?? true;
  WB.addWidget('latex', {
    latex: latex,
    lawTitle: (includeTitle && title) ? `${title}${code ? ' (' + code + ')' : ''}` : null,
    w: 380,
    h: includeTitle ? 145 : 120
  });
  WB.closePhysicsModal();
  if (title) WB.showToast(`Вставлена формула: ${title}`);
};

WB.renderPhysicsTabs = function() {
  const secContainer = document.getElementById('physicsSectionsBar');
  const subContainer = document.getElementById('physicsSubtopicsBar');
  if (!secContainer || !subContainer) return;

  const isSearching = Boolean((WB.physicsState.searchQuery || '').trim());

  const getSectionCount = (secId) => {
    if (secId === 'fav') return WB.physicsState.favorites.size;
    return WB.PHYSICS_FORMULAS.filter(f => f.section === secId).length;
  };

  secContainer.innerHTML = WB.PHYSICS_SECTIONS.map((sec, idx) => {
    const isAct = WB.physicsState.activeSection === sec.id && !isSearching;
    const count = getSectionCount(sec.id);
    const icon = PHYSICS_SECTION_ICONS[sec.id] || '';
    const divider = idx === 1 ? '<div class="phys-nav-divider" aria-hidden="true"></div>' : '';

    let nestedSubHtml = '';
    if (isAct && sec.subtopics.length > 1) {
      nestedSubHtml = `<div class="phys-nav-sublist">` + sec.subtopics.map(sub => {
        const subAct = WB.physicsState.activeSubtopic === sub.id;
        return `<button type="button" class="phys-nav-sub-btn ${subAct ? 'active' : ''}" onclick="WB.setPhysicsSubtopic('${sub.id}')">${sub.title}</button>`;
      }).join('') + `</div>`;
    }

    return `${divider}<div class="phys-nav-group">
      <button type="button" class="phys-sec-btn ${isAct ? 'active' : ''}" onclick="WB.setPhysicsSection('${sec.id}')">
        <span class="phys-sec-icon">${icon}</span>
        <span class="phys-sec-label">${sec.title}</span>
        <span class="phys-sec-count">${count}</span>
      </button>
      ${nestedSubHtml}
    </div>`;
  }).join('');

  const curSecObj = WB.PHYSICS_SECTIONS.find(s => s.id === WB.physicsState.activeSection) || WB.PHYSICS_SECTIONS[1];
  if (isSearching || curSecObj.subtopics.length <= 1) {
    subContainer.innerHTML = '';
    subContainer.classList.remove('has-items');
  } else {
    subContainer.classList.add('has-items');
    subContainer.innerHTML = curSecObj.subtopics.map(sub => {
      const isAct = WB.physicsState.activeSubtopic === sub.id;
      return `<button type="button" class="phys-sub-chip ${isAct ? 'active' : ''}" onclick="WB.setPhysicsSubtopic('${sub.id}')">${sub.title}</button>`;
    }).join('');
  }
};

WB.renderPhysicsCatalog = function() {
  const grid = document.getElementById('physicsFormulasGrid');
  const countEl = document.getElementById('physicsCountLabel');
  const crumbEl = document.getElementById('physicsBreadcrumb');
  const clearBtn = document.getElementById('physicsSearchClearBtn');
  if (!grid) return;

  const rawQuery = (WB.physicsState.searchQuery || '').trim();
  const q = rawQuery.toLowerCase();
  const sec = WB.physicsState.activeSection;
  const sub = WB.physicsState.activeSubtopic;

  if (clearBtn) {
    clearBtn.style.display = rawQuery ? 'inline-flex' : 'none';
  }

  const filtered = WB.PHYSICS_FORMULAS.filter(item => {
    if (q) {
      return (
        item.title.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q) ||
        item.latex.toLowerCase().includes(q)
      );
    }
    if (sec === 'fav') {
      return WB.physicsState.favorites.has(item.code);
    }
    if (item.section !== sec) return false;
    if (sub !== 'all' && item.subtopic !== sub) return false;
    return true;
  });

  if (countEl) {
    countEl.textContent = WB.formatFormulaCountRu(filtered.length);
  }

  if (crumbEl) {
    if (rawQuery) {
      const safeQ = rawQuery.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      crumbEl.innerHTML = `<span>Результаты поиска: «${safeQ}»</span><button type="button" class="phys-reset-link" onclick="WB.clearPhysicsSearch()">Сбросить</button>`;
    } else {
      const curSecObj = WB.PHYSICS_SECTIONS.find(s => s.id === sec);
      const curSubObj = curSecObj && curSecObj.subtopics.find(st => st.id === sub);
      const secName = curSecObj ? curSecObj.title : '';
      const subPart = (curSubObj && sub !== 'all') ? ` <span class="phys-crumb-sep" aria-hidden="true">/</span> <span>${curSubObj.title}</span>` : '';
      crumbEl.innerHTML = `<span>${secName}</span>${subPart}`;
    }
  }

  if (filtered.length === 0) {
    const isFavEmpty = !rawQuery && sec === 'fav';
    grid.innerHTML = `
      <div class="phys-empty-state">
        <div class="phys-empty-icon" aria-hidden="true">
          ${isFavEmpty
            ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
            : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
          }
        </div>
        <div class="phys-empty-title">${isFavEmpty ? 'В избранном пока пусто' : 'Формулы не найдены'}</div>
        <div class="phys-empty-desc">${
          isFavEmpty
            ? 'Отмечайте нужные формулы звёздочкой, чтобы быстро возвращаться к ним на уроке.'
            : 'Попробуйте другой запрос — например: «Ньютон», «Ом», «КПД», «линза» или код ФИПИ.'
        }</div>
        ${rawQuery ? '<button type="button" class="phys-empty-btn" onclick="WB.clearPhysicsSearch()">Сбросить поиск</button>' : ''}
      </div>
    `;
    return;
  }

  const starOutlineSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  const starFilledSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  const editSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
  const plusSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  const frag = document.createDocumentFragment();
  for (const item of filtered) {
    const isFav = WB.physicsState.favorites.has(item.code);
    const subtopicName = WB.getPhysicsSubtopicName(item.section, item.subtopic);
    const card = document.createElement('article');
    card.className = 'phys-formula-card';

    card.innerHTML = `
      <div class="phys-card-top">
        <div class="phys-card-meta">
          <span class="phys-code-text">ФИПИ ${item.code}</span>
          ${subtopicName ? `<span class="phys-meta-dot" aria-hidden="true">·</span><span class="phys-topic-text">${subtopicName}</span>` : ''}
        </div>
        <button type="button" class="phys-fav-btn ${isFav ? 'active' : ''}" aria-label="${isFav ? 'Убрать из избранного' : 'Добавить в избранное'}: ${item.title}" title="${isFav ? 'Убрать из избранного' : 'В избранное'}">
          ${isFav ? starFilledSvg : starOutlineSvg}
        </button>
      </div>
      <h4 class="phys-card-title">${item.title}</h4>
      <div class="phys-card-math" title="Нажмите, чтобы добавить формулу на доску"></div>
      <div class="phys-card-footer">
        <p class="phys-card-hint">${item.hint}</p>
        <div class="phys-card-actions">
          <button type="button" class="phys-action-btn secondary" title="Открыть в редакторе LaTeX для изменения">
            ${editSvg}
            <span>В LaTeX</span>
          </button>
          <button type="button" class="phys-action-btn primary" title="Вставить формулу на доску">
            ${plusSvg}
            <span>На доску</span>
          </button>
        </div>
      </div>
    `;

    const mathContainer = card.querySelector('.phys-card-math');
    const latexParts = WB.splitLatexFormulaParts(item.latex);
    if (latexParts.length > 1) {
      mathContainer.classList.add('is-multi');
      for (const part of latexParts) {
        const partEl = document.createElement('span');
        partEl.className = 'phys-math-part';
        WB.renderLatexInto(part, partEl);
        mathContainer.appendChild(partEl);
      }
    } else {
      const partEl = document.createElement('span');
      partEl.className = 'phys-math-part';
      WB.renderLatexInto(item.latex, partEl);
      mathContainer.appendChild(partEl);
    }

    const favBtn = card.querySelector('.phys-fav-btn');
    favBtn.addEventListener('click', (e) => WB.togglePhysicsFav(item.code, e));

    const editBtn = card.querySelector('.phys-action-btn.secondary');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      WB.closePhysicsModal();
      const input = document.getElementById('latexInput');
      if (input) input.value = item.latex;
      WB.openLatexModal(null);
    });

    const insertAction = () => {
      WB.insertPhysicsFormula(item.latex, item.title, item.code);
    };

    card.querySelector('.phys-action-btn.primary').addEventListener('click', (e) => {
      e.stopPropagation();
      insertAction();
    });

    mathContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      insertAction();
    });

    frag.appendChild(card);
  }

  grid.innerHTML = '';
  grid.appendChild(frag);
};

// Открытие официального PDF Кодификатора ФИПИ 2027 прямо во встроенном PDF-редакторе
WB.openCodifierPdfInEditor = async function() {
  WB.closePhysicsModal();
  if (typeof WB.openPdfUrlInEditor === 'function') {
    const isHttp = /^https?:$/i.test(window.location.protocol);
    const pdfPath = isHttp
      ? '/assets/aistudio/__-11_____2027_______d8a4122a.pdf'
      : 'public/assets/aistudio/__-11_____2027_______d8a4122a.pdf';
    await WB.openPdfUrlInEditor(pdfPath, 'Кодификатор ЕГЭ 2027 — Физика.pdf');
  }
};
