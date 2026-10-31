/* 冲刺分层：主线 / 下线 / 文献分组
   口径：2026—2027 考季只留「真题反复考 + 考纲必背结论 + 2026 整周年」三类；
   过程性细节条目下线（数据仍在文件里，切「全量」可回看），文献类不再混入主线。 */
window.ZZX_TIER = {
  note: "默认只看主线；「全量」开关可恢复全部条目（含已下线细节与 34 篇文献）。",
  sg: {
    main: [
      "sg-1839-humen", "sg-1840-yapian", "sg-1856-yapian2", "sg-1861-yangwu", "sg-1894-jiawu",
      "sg-1898-wuxu", "sg-1900-baguo", "sg-1911-xinhai", "sg-1912-minguo", "sg-1915-xinwenhua",
      "sg-1919-wusi", "sg-1921-yida", "sg-1922-erda", "sg-1923-sanda", "sg-1924-guoda",
      "sg-1925-wusa", "sg-1926-beifa", "sg-1927-nanchang", "sg-1927-baqi", "sg-1927-qiushou",
      "sg-1927-jinggang", "sg-1929-gutian", "sg-1931-918", "sg-1934-changzheng", "sg-1935-zunyi",
      "sg-1936-xian", "sg-1937-77", "sg-1938-liujie", "sg-1945-qida", "sg-1945-kangsheng",
      "sg-1949-erzhong", "sg-1949-xinzhongguo", "sg-1951-xizang", "sg-1953-guodu", "sg-1954-xianfa",
      "sg-1956-shida", "sg-1956-bada", "sg-1971-lianhe", "sg-1978-zhenli", "sg-1978-shiyijie",
      "sg-1982-shierda", "sg-1992-nanfang", "sg-1992-shisida", "sg-2012-shibada", "sg-2017-shijiuda",
      "sg-2021-xiaokang", "sg-2024-3z", "sg-2025-4z",
      "sg-1950-kangmei", "sg-1964-yuanzi", "sg-1980-tequ", "sg-1987-shisanda"
    ],
    cut: [
      "sg-1841-sanyuanli", "sg-1851-taiping", "sg-1876-zuozongtang", "sg-1883-zhongfa",
      "sg-1899-yihetuan", "sg-1919-wenti", "sg-1931-suwei", "sg-1935-wayao", "sg-1935-yierjiu",
      "sg-1937-luochuan", "sg-1937-gonghe", "sg-1937-nanjing", "sg-1937-pingxing",
      "sg-1938-taier", "sg-1940-baituan", "sg-1941-wannan", "sg-1945-chongqing"
    ],
    docHide: true
  },
  mao: { main: [], cut: [] },
  my: { main: [], cut: [] },
  sf: { main: [], cut: [] },
  xc: { main: [], cut: [] },
  /* 单元真题热度（2010—2023 年 462 道真题按章节统计），学习页在面包屑下方提示 */
  hot: {
    sg1: 26, sg2: 30, sg3: 16, sg4: 12, sg5: 7, sg6: 12, sg7: 2,
    mao1: 10, mao2: 17, mao3: 26, mao4: 41, mao5: 6, mao6: 14,
    my0: 5, my1: 14, my2: 10, my3: 5, my4: 25, my5: 53, my6: 12,
    sf1: 5, sf2: 4, sf3: 13, sf4: 4, sf5: 14, sf6: 30,
    xc1: 22, xc2: 27
  }
};
