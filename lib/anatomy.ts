/**
 * CareLens content model.
 *
 * The explorer used to carry four areas and one sentence each, held inline in
 * the component. Five areas with per-region medical content is too much to keep
 * next to the JSX, and it is the kind of copy a surgeon has to review — so it
 * lives here, in one file, where it can be read without reading React.
 *
 * ## What this model deliberately does not claim
 *
 * The geometry in `TreatmentCanvas` is generated in code: lathed shells, an
 * arch of parametric teeth. It is a **study model** — accurate enough to point
 * at, and explicitly not a diagnostic or anatomically exact rendering. Nothing
 * in this file should describe it as one. The Egyptian Medical Syndicate
 * governs how medical services may be advertised, and an accuracy claim is a
 * claim the practice makes, not a claim the renderer can support.
 *
 * ## Procedures must be bookable
 *
 * `procedures` on every region names only services that exist in
 * `lib/clinic.ts` and can actually be booked. Anything the practice discusses
 * but does not list goes in `discussed`, which the UI renders as conversation
 * topics rather than as an offer. A region that advertises a treatment the
 * booking form cannot take is a dead end for the patient and an advertising
 * problem for the clinic.
 */

export type AreaId = "face" | "nose" | "body" | "breast" | "dental" | "dermatology";

/**
 * The three depths the model can show.
 *
 * Named for what the viewer sees rather than for a tissue plane. "Muscle" and
 * "fascia" would imply the shell is those things; it is not. `surface` is the
 * outer form, `structure` the supporting frame beneath it, `skeleton` the bone.
 */
export type LayerId = "surface" | "structure" | "skeleton";

export const LAYERS: Array<{ id: LayerId; en: string; ar: string; hint: string; arHint: string }> = [
  {
    id: "surface",
    en: "Surface",
    ar: "السطح",
    hint: "Skin, contour, and the shape you see in a mirror.",
    arHint: "الجلد والشكل الخارجي كما تراه في المرآة.",
  },
  {
    id: "structure",
    en: "Structure",
    ar: "الدعامة",
    hint: "The support beneath the skin that holds the shape.",
    arHint: "الدعامة تحت الجلد التي تحافظ على الشكل.",
  },
  {
    id: "skeleton",
    en: "Skeleton",
    ar: "الهيكل",
    hint: "The bone the whole form is built on.",
    arHint: "العظام التي يُبنى عليها الشكل كله.",
  },
];

export type Region = {
  id: string;
  en: string;
  ar: string;
  /** Shallowest layer at which this region is visible. */
  layer: LayerId;
  /** Anchor point on the model, in the canvas's own units. */
  at: [number, number, number];
  overview: string;
  arOverview: string;
  /** Anatomy involved. Plain names, not Latin. */
  structures: string[];
  arStructures: string[];
  /** Bookable today. Must match a service id in lib/clinic.ts. */
  procedures: string[];
  arProcedures: string[];
  /** Raised at consultation but not on the booking form. */
  discussed?: string[];
  arDiscussed?: string[];
  recovery: string;
  arRecovery: string;
};

export type Area = {
  id: AreaId;
  number: string;
  en: string;
  ar: string;
  feeling: string;
  arFeeling: string;
  description: string;
  arDescription: string;
  /** Camera framing for this area. */
  view: { azimuth: number; elevation: number; distance: number; target: number };
  /** Which model the canvas builds for this area. */
  model: "bust" | "arch";
  /**
   * Area-specific wording for the depth control.
   *
   * The default hints describe a body — "the shape you see in a mirror" is a
   * reasonable gloss for a cheek and a meaningless one for a molar. An area
   * overrides only the depths where the general wording would be wrong.
   */
  layerHints?: Partial<Record<LayerId, { en: string; ar: string }>>;
  regions: Region[];
};

export const AREAS: Area[] = [
  /* ── 01 · Face & neck ─────────────────────────────────────────────────── */
  {
    id: "face",
    number: "01",
    en: "Face & neck",
    ar: "الوجه والرقبة",
    feeling: "I want to look fresher, without looking different.",
    arFeeling: "أريد مظهراً أكثر حيوية بدون تغيير ملامحي.",
    description: "Skin, volume, and the support underneath decide how rested a face reads.",
    arDescription: "البشرة والحجم والدعامة تحتها هي ما يجعل الوجه يبدو مرتاحاً.",
    view: { azimuth: -0.28, elevation: 0.02, distance: 7.5, target: -0.18 },
    model: "bust",
    regions: [
      {
        id: "brow",
        en: "Brow & forehead",
        ar: "الجبهة والحاجب",
        layer: "surface",
        at: [0.0, 1.3, 0.4],
        overview:
          "The brow sets the expression a face wears at rest. As support loosens the outer brow descends first, which reads as tiredness even when nothing else has changed.",
        arOverview:
          "الحاجب هو ما يحدد تعبير الوجه في وضع الراحة. مع ارتخاء الدعامة ينزل طرف الحاجب أولاً، فيبدو الوجه متعباً دون أي تغيير آخر.",
        structures: ["Forehead skin", "Brow support", "Frontal bone", "Upper eye socket rim"],
        arStructures: ["جلد الجبهة", "دعامة الحاجب", "عظم الجبهة", "حافة محجر العين العلوية"],
        procedures: ["Face & neck consultation"],
        arProcedures: ["استشارة الوجه والرقبة"],
        discussed: ["Facial rejuvenation", "Brow position and symmetry", "Non-surgical options first"],
        arDiscussed: ["تجديد شباب الوجه", "موضع الحاجب والتماثل", "الخيارات غير الجراحية أولاً"],
        recovery: "Swelling settles over the first two weeks. Bruising, if any, is usually covered by week two.",
        arRecovery: "يهدأ التورم خلال أول أسبوعين. الكدمات، إن وُجدت، تختفي غالباً بنهاية الأسبوع الثاني.",
      },
      {
        id: "eyelid",
        en: "Eyelids",
        ar: "الجفون",
        layer: "surface",
        at: [-0.21, 1.17, 0.4],
        overview:
          "Eyelid skin is the thinnest on the body, so it shows change earliest. Upper lids gain loose skin; lower lids more often change in volume than in skin.",
        arOverview:
          "جلد الجفن هو الأرق في الجسم، لذلك يظهر التغيير عليه أولاً. الجفن العلوي يزيد فيه الجلد المترهل، والسفلي يتغير حجمه أكثر مما يتغير جلده.",
        structures: ["Eyelid skin", "Eyelid muscle", "Orbital fat", "Tear trough"],
        arStructures: ["جلد الجفن", "عضلة الجفن", "دهون المحجر", "أخدود الدمع"],
        procedures: ["Face & neck consultation"],
        arProcedures: ["استشارة الوجه والرقبة"],
        discussed: ["Eyelid surgery", "Upper and lower lid together or separately", "Vision and dryness assessment"],
        arDiscussed: ["جراحة الجفون", "الجفن العلوي والسفلي معاً أو منفصلين", "تقييم الرؤية وجفاف العين"],
        recovery: "Stitches come out within a week. Most people are comfortable in company by two weeks.",
        arRecovery: "تُزال الغرز خلال أسبوع. معظم الناس يشعرون بالراحة بين الآخرين خلال أسبوعين.",
      },
      {
        id: "midface",
        en: "Mid Face",
        ar: "الخد ومنتصف الوجه",
        layer: "structure",
        at: [-0.36, 0.98, 0.3],
        overview:
          "The mid face includes the cheeks and upper jaw area. Procedures here restore volume, lift soft tissues, and improve facial harmony.",
        arOverview:
          "منتصف الوجه يفقد حجمه قبل أن يفقد جلده. لذلك قد يبدو الوجه أنحف وأكبر سناً في نفس الوقت، ولذلك تعويض الحجم غالباً أفضل من الشد.",
        structures: ["Cheek fat", "Deep support layer", "Cheekbone", "Nose-to-mouth fold"],
        arStructures: ["دهون الخد", "طبقة الدعم العميقة", "عظمة الخد", "الخط بين الأنف والفم"],
        procedures: ["Face & neck consultation", "Non-surgical aesthetics"],
        arProcedures: ["استشارة الوجه والرقبة", "تجميل بدون جراحة"],
        discussed: ["Fat grafting", "How much volume is enough", "Where fat is taken from"],
        arDiscussed: ["نقل الدهون", "ما هو الحجم المناسب", "من أين تُؤخذ الدهون"],
        recovery: "Grafted fat settles over three months. The early result is always fuller than the final one.",
        arRecovery: "تستقر الدهون المنقولة خلال ثلاثة أشهر. النتيجة المبكرة دائماً أكبر من النهائية.",
      },
      {
        id: "jawline",
        en: "Jawline",
        ar: "خط الفك",
        layer: "structure",
        at: [-0.3, 0.74, 0.26],
        overview:
          "A defined jawline depends on three things at once: the bone under it, the fat over it, and how tight the skin sits between them. Only some of that is skin.",
        arOverview:
          "وضوح خط الفك يعتمد على ثلاثة أشياء معاً: العظم تحته، والدهون فوقه، وشد الجلد بينهما. الجلد جزء واحد فقط من الصورة.",
        structures: ["Jaw bone", "Jowl fat", "Neck-to-jaw angle", "Skin tone"],
        arStructures: ["عظم الفك", "دهون الفك السفلي", "الزاوية بين الرقبة والفك", "مرونة الجلد"],
        procedures: ["Face & neck consultation"],
        arProcedures: ["استشارة الوجه والرقبة"],
        discussed: ["Facial rejuvenation", "Neck and jaw as one unit", "Whether bone or soft tissue leads"],
        arDiscussed: ["تجديد شباب الوجه", "الرقبة والفك كوحدة واحدة", "هل العظم أم الأنسجة هو الأساس"],
        recovery: "A support garment for the first days. Definition keeps improving for several months.",
        arRecovery: "رباط داعم في الأيام الأولى. يستمر تحسّن الوضوح لعدة أشهر.",
      },
      {
        id: "neck",
        en: "Neck",
        ar: "الرقبة",
        layer: "surface",
        at: [0.0, 0.44, 0.22],
        overview:
          "The neck is often what makes an otherwise rested face look older. Bands, fullness under the chin, and loose skin are three different problems with three different answers.",
        arOverview:
          "الرقبة غالباً هي ما يجعل الوجه المرتاح يبدو أكبر سناً. الأربطة والامتلاء تحت الذقن والجلد المترهل ثلاث مشاكل مختلفة بثلاثة حلول مختلفة.",
        structures: ["Neck muscle bands", "Fat under the chin", "Neck skin", "Chin projection"],
        arStructures: ["أربطة عضلات الرقبة", "الدهون تحت الذقن", "جلد الرقبة", "بروز الذقن"],
        procedures: ["Face & neck consultation"],
        arProcedures: ["استشارة الوجه والرقبة"],
        discussed: ["Facial rejuvenation", "Bands, fullness and loose skin are three problems"],
        arDiscussed: ["تجديد شباب الوجه", "الأربطة والامتلاء والترهل ثلاث مشاكل مختلفة"],
        recovery: "Bruising is common in the first ten days. Final contour reads at around three months.",
        arRecovery: "الكدمات شائعة في أول عشرة أيام. الشكل النهائي يتضح بعد حوالي ثلاثة أشهر.",
      },
    ],
  },

  /* ── 02 · Nose & profile ──────────────────────────────────────────────── */
  {
    id: "nose",
    number: "02",
    en: "Nose & profile",
    ar: "الأنف وتناسق الوجه",
    feeling: "I want balance from every angle — and to breathe well.",
    arFeeling: "أريد تناسقاً من كل زاوية وتنفساً أفضل.",
    description: "Shape and breathing share the same structure, so they are planned together.",
    arDescription: "الشكل والتنفس يشتركان في نفس التكوين، لذلك يُخطط لهما معاً.",
    view: { azimuth: 0.66, elevation: 0.02, distance: 5.6, target: 0.62 },
    model: "bust",
    regions: [
      {
        id: "dorsum",
        en: "Bridge",
        ar: "جسر الأنف",
        layer: "surface",
        at: [0.0, 1.12, 0.44],
        overview:
          "The bridge is bone at the top and cartilage below it. A bump is usually the join between the two, which is why the profile changes shape rather than simply reducing.",
        arOverview:
          "جسر الأنف عظم في أعلاه وغضروف تحته. النتوء غالباً يكون عند التقاء الاثنين، ولذلك يتغير شكل الجانب بدل أن يصغر فقط.",
        structures: ["Nasal bone", "Upper cartilage", "Skin thickness"],
        arStructures: ["عظم الأنف", "الغضروف العلوي", "سمك الجلد"],
        procedures: ["Rhinoplasty consultation"],
        arProcedures: ["استشارة تجميل الأنف"],
        discussed: ["Rhinoplasty", "Profile balancing", "Bump, width, and straightness separately", "Skin thickness and what it hides"],
        arDiscussed: ["تجميل الأنف", "موازنة الملامح الجانبية", "النتوء والعرض والاستقامة كلٌ على حدة", "سمك الجلد وما يخفيه"],
        recovery: "A splint for the first week. Most swelling goes in a month; the last of it takes a year.",
        arRecovery: "جبيرة في الأسبوع الأول. معظم التورم يزول خلال شهر، وآخره يحتاج سنة.",
      },
      {
        id: "tip",
        en: "Tip",
        ar: "أرنبة الأنف",
        layer: "structure",
        at: [0.0, 1.0, 0.5],
        overview:
          "The tip is supported by paired cartilages, not bone. It is the hardest part to change predictably, because thick skin hides refinement and thin skin shows everything.",
        arOverview:
          "الأرنبة يدعمها غضروفان، وليس عظماً. وهي أصعب جزء في التغيير المتوقع، لأن الجلد السميك يخفي التفاصيل والرقيق يُظهر كل شيء.",
        structures: ["Tip cartilages", "Tip support", "Skin thickness", "Nose-to-lip angle"],
        arStructures: ["غضاريف الأرنبة", "دعامة الأرنبة", "سمك الجلد", "الزاوية بين الأنف والشفة"],
        procedures: ["Rhinoplasty consultation"],
        arProcedures: ["استشارة تجميل الأنف"],
        discussed: ["Rhinoplasty", "What thick or thin skin will show"],
        arDiscussed: ["تجميل الأنف", "ما الذي يُظهره الجلد السميك أو الرقيق"],
        recovery: "The tip is the last area to settle. Judge it at twelve months, not at three.",
        arRecovery: "الأرنبة آخر ما يستقر. احكم عليها بعد اثني عشر شهراً، لا بعد ثلاثة.",
      },
      {
        id: "septum",
        en: "Septum & airway",
        ar: "الحاجز الأنفي والتنفس",
        layer: "skeleton",
        at: [0.0, 1.06, 0.36],
        overview:
          "The septum is the wall down the middle. When it is bent it narrows one side, and straightening it is a breathing operation that happens to change the outside too.",
        arOverview:
          "الحاجز هو الجدار في منتصف الأنف. عندما يكون معوجاً يضيّق جانباً واحداً، وتعديله عملية تنفس تغيّر الشكل الخارجي أيضاً.",
        structures: ["Septal cartilage", "Septal bone", "Turbinates", "Nasal valve"],
        arStructures: ["غضروف الحاجز", "عظم الحاجز", "القرينات", "صمام الأنف"],
        procedures: ["Rhinoplasty consultation"],
        arProcedures: ["استشارة تجميل الأنف"],
        discussed: ["Septorhinoplasty", "Breathing tests before shape planning", "Whether cartilage is needed as a graft"],
        arDiscussed: ["تجميل وتعديل الحاجز الأنفي", "فحص التنفس قبل التخطيط للشكل", "هل نحتاج غضروفاً للترقيع"],
        recovery: "Breathing feels blocked for one to two weeks while the lining heals, then improves steadily.",
        arRecovery: "التنفس يكون مسدوداً لأسبوع أو اثنين أثناء التئام البطانة، ثم يتحسن تدريجياً.",
      },
      {
        id: "alar",
        en: "Nostrils & base",
        ar: "فتحتا الأنف والقاعدة",
        layer: "surface",
        at: [-0.12, 0.96, 0.44],
        overview:
          "Base width is measured against the eyes, not in isolation. Narrowing it leaves a scar in the crease at the side of the nostril, which is placed to hide but never disappears.",
        arOverview:
          "عرض القاعدة يُقاس بالنسبة للعينين، لا بمفرده. تضييقها يترك أثراً في الثنية بجانب فتحة الأنف، يوضع ليختفي لكنه لا يزول تماماً.",
        structures: ["Nostril rim", "Base width", "Nostril shape", "Upper lip junction"],
        arStructures: ["حافة فتحة الأنف", "عرض القاعدة", "شكل الفتحة", "التقاء الشفة العليا"],
        procedures: ["Rhinoplasty consultation"],
        arProcedures: ["استشارة تجميل الأنف"],
        discussed: ["Rhinoplasty", "Profile balancing", "Where the scar sits and how it fades"],
        arDiscussed: ["تجميل الأنف", "موازنة الملامح الجانبية", "أين يقع الأثر وكيف يخف"],
        recovery: "Fine stitches for a week. The scar fades over six to twelve months.",
        arRecovery: "غرز دقيقة لمدة أسبوع. يخف الأثر خلال ستة إلى اثني عشر شهراً.",
      },
    ],
  },

  /* ── 03 · Body architecture ───────────────────────────────────────────── */
  {
    id: "body",
    number: "03",
    en: "Body architecture",
    ar: "هندسة القوام",
    feeling: "My shape no longer reflects how I feel.",
    arFeeling: "قوامي لم يعد يعكس إحساسي بنفسي.",
    description: "Proportion, skin quality, and muscle support are assessed as one system.",
    arDescription: "التناسق وجودة الجلد ودعم العضلات تُقيَّم كنظام واحد.",
    view: { azimuth: -0.18, elevation: -0.08, distance: 7.6, target: -0.2 },
    model: "bust",
    regions: [
      {
        id: "abdomen",
        en: "Abdominal wall",
        ar: "جدار البطن",
        layer: "structure",
        at: [0.0, -0.34, 0.5],
        overview:
          "Three separate things make an abdomen look full: fat above the muscle, fat under it, and muscle that has stretched apart. Only the first responds to weight loss.",
        arOverview:
          "ثلاثة أشياء تجعل البطن ممتلئاً: دهون فوق العضلة، ودهون تحتها، وعضلات تباعدت. الأول فقط هو ما يستجيب لإنقاص الوزن.",
        structures: ["Skin and fat layer", "Muscle wall", "Muscle separation", "Deep fat"],
        arStructures: ["طبقة الجلد والدهون", "جدار العضلات", "تباعد العضلات", "الدهون العميقة"],
        procedures: ["Body contouring consultation"],
        arProcedures: ["استشارة تنسيق القوام"],
        discussed: ["Tummy tuck", "Liposculpture", "Whether muscle repair is needed", "Scar length and position"],
        arDiscussed: ["شد البطن", "نحت الجسم", "هل يلزم إصلاح العضلات", "طول الأثر وموضعه"],
        recovery: "Six weeks before full activity. Upright walking from the first day, deliberately limited.",
        arRecovery: "ستة أسابيع قبل النشاط الكامل. المشي منتصباً من اليوم الأول، بشكل محدود ومقصود.",
      },
      {
        id: "flank",
        en: "Waist & flanks",
        ar: "الخصر والجانبان",
        layer: "surface",
        at: [0.52, -0.3, 0.3],
        overview:
          "The waist is read as a ratio, not a measurement. Removing fat from one place changes how every neighbouring area looks, which is why contouring is planned across the whole trunk.",
        arOverview:
          "الخصر يُقرأ كنسبة، لا كقياس. إزالة الدهون من مكان تغيّر شكل ما حوله، لذلك يُخطط للنحت على الجذع كله.",
        structures: ["Surface fat", "Skin elasticity", "Rib and hip position"],
        arStructures: ["الدهون السطحية", "مرونة الجلد", "موضع الأضلاع والورك"],
        procedures: ["Body contouring consultation"],
        arProcedures: ["استشارة تنسيق القوام"],
        discussed: ["Liposculpture", "Contouring planned across the whole trunk"],
        arDiscussed: ["نحت الجسم", "النحت يُخطط له على الجذع كله"],
        recovery: "A compression garment for six weeks. Swelling hides the result for the first month.",
        arRecovery: "مشد ضاغط لمدة ستة أسابيع. التورم يخفي النتيجة في الشهر الأول.",
      },
      {
        id: "posture",
        en: "Frame & posture",
        ar: "الهيكل والقوام",
        layer: "skeleton",
        at: [0.0, -0.05, 0.24],
        overview:
          "Shoulder width, rib shape, and pelvis position are fixed. They set what proportion is achievable, and an honest plan starts by saying which parts of the frame will not change.",
        arOverview:
          "عرض الكتفين وشكل القفص الصدري وموضع الحوض ثابتة. هي التي تحدد التناسق الممكن، والخطة الصادقة تبدأ بتوضيح ما لن يتغير.",
        structures: ["Shoulder girdle", "Rib cage", "Spine curve", "Pelvis"],
        arStructures: ["حزام الكتف", "القفص الصدري", "انحناء العمود الفقري", "الحوض"],
        procedures: [],
        arProcedures: [],
        discussed: ["What proportion is realistic for your frame", "Posture and core strength before surgery"],
        arDiscussed: ["ما التناسق الواقعي لهيكلك", "القوام وقوة العضلات قبل الجراحة"],
        recovery: "No procedure here. This is the measurement the rest of the plan is built against.",
        arRecovery: "لا يوجد إجراء هنا. هذا هو القياس الذي تُبنى عليه بقية الخطة.",
      },
      {
        id: "post-weight",
        en: "After weight loss",
        ar: "بعد إنقاص الوزن",
        layer: "surface",
        at: [-0.5, -0.2, 0.36],
        overview:
          "Skin that has been stretched for years does not fully retract. After major weight loss the question stops being fat and becomes where to place the scars that remove skin.",
        arOverview:
          "الجلد الذي تمدد لسنوات لا يعود كما كان. بعد إنقاص وزن كبير، السؤال لم يعد عن الدهون بل عن مكان الأثر الذي يزيل الجلد.",
        structures: ["Loose skin", "Residual fat", "Scar position", "Skin quality"],
        arStructures: ["الجلد المترهل", "الدهون المتبقية", "موضع الأثر", "جودة الجلد"],
        procedures: ["Body contouring consultation"],
        arProcedures: ["استشارة تنسيق القوام"],
        discussed: ["Post-weight-loss care", "Tummy tuck", "Weight stability for six months first", "Staging across more than one operation"],
        arDiscussed: ["رعاية ما بعد إنقاص الوزن", "شد البطن", "ثبات الوزن ستة أشهر أولاً", "التقسيم على أكثر من عملية"],
        recovery: "Longer than a standard procedure, and usually staged. Planned in months, not weeks.",
        arRecovery: "أطول من الإجراء العادي، وغالباً على مراحل. يُخطط له بالأشهر لا بالأسابيع.",
      },
    ],
  },

  /* ── 04 · Breast proportion ───────────────────────────────────────────── */
  {
    id: "breast",
    number: "04",
    en: "Breast proportion",
    ar: "تناسق الثدي",
    feeling: "I want proportion, comfort, and confidence.",
    arFeeling: "أبحث عن التناسق والراحة والثقة.",
    description: "A private conversation about size, position, symmetry, scars, and time.",
    arDescription: "حوار بخصوصية حول الحجم والموضع والتماثل والأثر والزمن.",
    view: { azimuth: -0.4, elevation: -0.03, distance: 7.35, target: -0.12 },
    model: "bust",
    regions: [
      {
        id: "position",
        en: "Position & symmetry",
        ar: "الموضع والتماثل",
        layer: "surface",
        at: [-0.34, -0.14, 0.42],
        overview:
          "Almost nobody is symmetrical, and the difference is usually known before the consultation. Naming it early makes the plan honest, because surgery reduces a difference rather than erasing it.",
        arOverview:
          "التماثل التام نادر جداً، والفرق يكون معروفاً قبل الاستشارة غالباً. ذكره مبكراً يجعل الخطة صادقة، لأن الجراحة تقلل الفرق ولا تمحوه.",
        structures: ["Breast position", "Fold position", "Chest wall shape", "Skin envelope"],
        arStructures: ["موضع الثدي", "موضع الطية", "شكل جدار الصدر", "غلاف الجلد"],
        procedures: ["Breast surgery consultation"],
        arProcedures: ["استشارة جراحات الثدي"],
        discussed: ["Lift", "Which side leads the plan", "What symmetry is realistically achievable"],
        arDiscussed: ["رفع الثدي", "أي جانب يقود الخطة", "ما التماثل الممكن واقعياً"],
        recovery: "Support bra for six weeks. Position settles over three to six months.",
        arRecovery: "حمالة داعمة لستة أسابيع. يستقر الموضع خلال ثلاثة إلى ستة أشهر.",
      },
      {
        id: "volume",
        en: "Volume & proportion",
        ar: "الحجم والتناسق",
        layer: "structure",
        at: [-0.3, -0.28, 0.44],
        overview:
          "Volume is chosen against your frame — chest width, shoulder line, and height — not from a number. Two people who ask for the same size rarely suit the same result.",
        arOverview:
          "الحجم يُختار بالنسبة لهيكلك: عرض الصدر وخط الكتف والطول، لا برقم. شخصان يطلبان نفس المقاس نادراً ما يناسبهما نفس النتيجة.",
        structures: ["Breast tissue", "Skin envelope", "Chest width", "Shoulder line"],
        arStructures: ["نسيج الثدي", "غلاف الجلد", "عرض الصدر", "خط الكتف"],
        procedures: ["Breast surgery consultation"],
        arProcedures: ["استشارة جراحات الثدي"],
        discussed: ["Augmentation", "Reduction", "Implant plane and its trade-offs", "Long-term revision expectations"],
        arDiscussed: ["تكبير الثدي", "تصغير الثدي", "مستوى وضع الحشوة ومميزاته وعيوبه", "توقعات التعديل على المدى الطويل"],
        recovery: "Two weeks of restricted arm movement. Comfortable in clothes by around a month.",
        arRecovery: "أسبوعان من تقييد حركة الذراع. الراحة في الملابس بعد شهر تقريباً.",
      },
      {
        id: "chest-support",
        en: "Chest support",
        ar: "دعامة الصدر",
        layer: "skeleton",
        at: [0.0, -0.26, 0.34],
        overview:
          "The chest muscle and rib cage underneath decide what sits where. When an implant is placed under the muscle it is better covered, but it moves when the muscle does.",
        arOverview:
          "عضلة الصدر والقفص الصدري تحتها هما ما يحدد موضع كل شيء. الحشوة تحت العضلة تكون مغطاة أفضل، لكنها تتحرك مع حركة العضلة.",
        structures: ["Chest muscle", "Rib cage", "Muscle plane", "Fold support"],
        arStructures: ["عضلة الصدر", "القفص الصدري", "مستوى العضلة", "دعامة الطية"],
        procedures: ["Breast surgery consultation"],
        arProcedures: ["استشارة جراحات الثدي"],
        discussed: ["Augmentation", "Above or below the muscle"],
        arDiscussed: ["تكبير الثدي", "فوق العضلة أم تحتها"],
        recovery: "Muscle soreness for the first ten days, more than skin discomfort.",
        arRecovery: "ألم عضلي في أول عشرة أيام، أكثر من ألم الجلد.",
      },
      {
        id: "scar",
        en: "Scars",
        ar: "الأثر الجراحي",
        layer: "surface",
        at: [-0.2, -0.4, 0.4],
        overview:
          "Every option here trades scar length against how much shape can change. That trade is the decision, and it is better made by you than assumed by a surgeon.",
        arOverview:
          "كل خيار هنا يوازن بين طول الأثر ومقدار التغيير الممكن في الشكل. هذه الموازنة هي القرار، والأفضل أن تتخذيه أنتِ لا أن يفترضه الجراح.",
        structures: ["Incision options", "Scar position", "Healing type", "Skin tone"],
        arStructures: ["خيارات الشق", "موضع الأثر", "نوع الالتئام", "لون البشرة"],
        procedures: ["Breast surgery consultation"],
        arProcedures: ["استشارة جراحات الثدي"],
        discussed: ["Lift", "Reduction", "Scar care from week three", "How your skin has healed before"],
        arDiscussed: ["رفع الثدي", "تصغير الثدي", "العناية بالأثر من الأسبوع الثالث", "كيف التأم جلدك سابقاً"],
        recovery: "Scars look their worst at six to eight weeks, then fade for a full year.",
        arRecovery: "يبدو الأثر في أسوأ حالاته بين الأسبوع السادس والثامن، ثم يخف على مدار سنة كاملة.",
      },
    ],
  },

  /* ── 05 · Dental ──────────────────────────────────────────────────────── */
  {
    id: "dental",
    number: "05",
    en: "Dental",
    ar: "الأسنان",
    feeling: "I want a smile that looks like mine, only better.",
    arFeeling: "أريد ابتسامة تشبهني، لكن أفضل.",
    description: "Teeth, gums, and bone are one structure. A smile is planned across all three.",
    arDescription: "الأسنان واللثة والعظم تكوين واحد. الابتسامة يُخطط لها عبر الثلاثة معاً.",
    view: { azimuth: 0.28, elevation: 0.19, distance: 6.9, target: 0.0 },
    model: "arch",
    layerHints: {
      surface: {
        en: "The enamel and the shape of the smile people see.",
        ar: "المينا وشكل الابتسامة التي يراها الناس.",
      },
      structure: {
        en: "Roots and gums — the half of every tooth that is hidden.",
        ar: "الجذور واللثة، وهي نصف كل سن المخفي.",
      },
    },
    regions: [
      {
        id: "smile-line",
        en: "Smile design",
        ar: "تصميم الابتسامة",
        layer: "surface",
        at: [0.0, 0.04, 0.95],
        overview:
          "A smile is judged by proportion, not by whiteness. The width of the front teeth against each other, and the line they follow against the lower lip, do most of the work.",
        arOverview:
          "الابتسامة تُقيَّم بالتناسق لا بالبياض. عرض الأسنان الأمامية بالنسبة لبعضها، والخط الذي ترسمه مع الشفة السفلى، هما الأساس.",
        structures: ["Front teeth", "Smile line", "Midline", "Lip position"],
        arStructures: ["الأسنان الأمامية", "خط الابتسامة", "خط المنتصف", "موضع الشفة"],
        procedures: ["Veneers & whitening"],
        arProcedures: ["الفينير وتبييض الأسنان"],
        discussed: ["A trial smile before anything is permanent", "Photographs at rest and smiling"],
        arDiscussed: ["ابتسامة تجريبية قبل أي شيء دائم", "صور في وضع الراحة وأثناء الابتسام"],
        recovery: "No downtime for whitening. Veneers involve a short period with temporaries.",
        arRecovery: "لا فترة نقاهة للتبييض. الفينير يتطلب فترة قصيرة بأسنان مؤقتة.",
      },
      {
        id: "crown",
        en: "Tooth crown",
        ar: "تاج السن",
        layer: "surface",
        at: [-0.29, 0.075, 0.86],
        overview:
          "The crown is the part you see: hard enamel over softer dentine. Veneers cover the front of it; a crown replaces the whole visible surface when too little tooth is left.",
        arOverview:
          "التاج هو الجزء الظاهر: مينا صلبة فوق عاج ألين. الفينير يغطي واجهته، والتاج يستبدل السطح الظاهر كله عندما يتبقى القليل من السن.",
        structures: ["Enamel", "Dentine", "Contact points", "Bite surface"],
        arStructures: ["المينا", "العاج", "نقاط التلامس", "سطح الإطباق"],
        procedures: ["Veneers & whitening", "Dental consultation & cleaning"],
        arProcedures: ["الفينير وتبييض الأسنان", "استشارة وتنظيف الأسنان"],
        discussed: ["How much enamel has to be removed", "Colour matched to neighbouring teeth"],
        arDiscussed: ["كم من المينا يجب إزالته", "مطابقة اللون مع الأسنان المجاورة"],
        recovery: "Sensitivity for a few days is normal. Avoid very hot and very cold at first.",
        arRecovery: "الحساسية لبضعة أيام أمر طبيعي. تجنب الساخن والبارد جداً في البداية.",
      },
      {
        id: "root",
        en: "Root & nerve",
        ar: "الجذر والعصب",
        layer: "structure",
        at: [0.29, -0.22, 0.79],
        overview:
          "Below the gum, each tooth is anchored by one or more roots with a living nerve inside. Pain that wakes you at night usually means that nerve, not the surface.",
        arOverview:
          "تحت اللثة، يُثبَّت كل سن بجذر أو أكثر بداخله عصب حي. الألم الذي يوقظك ليلاً يعني هذا العصب غالباً، لا السطح.",
        structures: ["Root canal", "Tooth nerve", "Root tip", "Blood supply"],
        arStructures: ["قناة الجذر", "عصب السن", "طرف الجذر", "التروية الدموية"],
        procedures: ["Dental consultation & cleaning"],
        arProcedures: ["استشارة وتنظيف الأسنان"],
        discussed: ["Whether the nerve can be saved", "X-rays before any decision"],
        arDiscussed: ["هل يمكن إنقاذ العصب", "أشعة قبل أي قرار"],
        recovery: "Root treatment usually settles within a week. The tooth often needs a crown afterwards.",
        arRecovery: "علاج الجذر يهدأ خلال أسبوع عادة. السن يحتاج تاجاً بعده غالباً.",
      },
      {
        id: "gum",
        en: "Gums",
        ar: "اللثة",
        layer: "structure",
        at: [-0.20, 0.21, 0.89],
        overview:
          "Gum health decides how long everything else lasts. It also frames the smile: a tooth can be the right shape and still look wrong if the gum line above it is uneven.",
        arOverview:
          "صحة اللثة تحدد عمر كل ما عداها. وهي أيضاً إطار الابتسامة: قد يكون السن بالشكل الصحيح ويبدو خاطئاً إذا كان خط اللثة فوقه غير مستوٍ.",
        structures: ["Gum tissue", "Gum line", "Attachment", "Bone level"],
        arStructures: ["نسيج اللثة", "خط اللثة", "الارتباط", "مستوى العظم"],
        procedures: ["Dental consultation & cleaning"],
        arProcedures: ["استشارة وتنظيف الأسنان"],
        discussed: ["Gum contouring as part of smile design", "Cleaning before cosmetic work"],
        arDiscussed: ["تحديد اللثة كجزء من تصميم الابتسامة", "التنظيف قبل العمل التجميلي"],
        recovery: "Gums are tender for a few days after deep cleaning, then firmer than before.",
        arRecovery: "تكون اللثة حساسة لبضعة أيام بعد التنظيف العميق، ثم تصبح أقوى من قبل.",
      },
      {
        id: "implant",
        en: "Implants",
        ar: "الزراعة",
        layer: "skeleton",
        at: [0.55, -0.26, 0.55],
        overview:
          "An implant replaces the root, not the tooth. A post is placed in the jaw bone, left to join with it over months, and only then does the visible tooth go on top.",
        arOverview:
          "الزراعة تستبدل الجذر لا السن. تُوضع دعامة في عظم الفك، وتُترك لتلتحم به على مدى أشهر، وبعدها فقط يُركَّب السن الظاهر.",
        structures: ["Jaw bone", "Implant post", "Bone density", "Gum seal"],
        arStructures: ["عظم الفك", "دعامة الزراعة", "كثافة العظم", "إغلاق اللثة"],
        procedures: ["Dental implants"],
        arProcedures: ["زراعة الأسنان"],
        discussed: ["Whether the bone needs building up first", "A temporary tooth while it heals"],
        arDiscussed: ["هل يحتاج العظم إلى تقوية أولاً", "سن مؤقت أثناء الالتئام"],
        recovery: "Three to six months between placing the post and fitting the tooth. Not a single visit.",
        arRecovery: "من ثلاثة إلى ستة أشهر بين وضع الدعامة وتركيب السن. ليست زيارة واحدة.",
      },
      {
        id: "jawbone",
        en: "Jaw & bite",
        ar: "الفك والإطباق",
        layer: "skeleton",
        at: [0.0, -0.26, 0.82],
        overview:
          "The upper and lower jaws have to meet evenly, or one tooth takes the load meant for several. A bite that is off will break cosmetic work no matter how well it is made.",
        arOverview:
          "يجب أن يلتقي الفكان بتساوٍ، وإلا تحمّل سن واحد ما هو مخصص لعدة أسنان. الإطباق الخاطئ يكسر العمل التجميلي مهما كان متقناً.",
        structures: ["Upper jaw", "Lower jaw", "Bite contact", "Jaw joint"],
        arStructures: ["الفك العلوي", "الفك السفلي", "تلامس الإطباق", "مفصل الفك"],
        procedures: ["Dental consultation & cleaning"],
        arProcedures: ["استشارة وتنظيف الأسنان"],
        discussed: ["Grinding and its effect on veneers", "Whether alignment comes first"],
        arDiscussed: ["الصرير وتأثيره على الفينير", "هل يأتي التقويم أولاً"],
        recovery: "Bite adjustments are small and immediate. Alignment plans run over months.",
        arRecovery: "تعديلات الإطباق بسيطة وفورية. خطط التقويم تمتد لأشهر.",
      },
    ],
  },
  /* -- 06 · Dermatology -------------------------------------------------- */
  {
    id: "dermatology",
    number: "06",
    en: "Dermatology",
    ar: "الأمراض الجلدية",
    feeling: "I want healthier skin that still looks like my skin.",
    arFeeling: "أريد بشرة أكثر صحة مع الحفاظ على مظهرها الطبيعي.",
    description: "Tone, texture, hydration, and long-term skin health are assessed together.",
    arDescription: "يُقيَّم لون البشرة وملمسها وترطيبها وصحتها على المدى الطويل معاً.",
    view: { azimuth: -0.2, elevation: 0.03, distance: 7.45, target: -0.16 },
    model: "bust",
    regions: [
      {
        id: "complexion",
        en: "Tone & clarity",
        ar: "اللون والصفاء",
        layer: "surface",
        at: [0.25, 1.12, 0.37],
        overview: "Uneven tone can come from pigment, redness, sun exposure, or inflammation. Identifying the cause comes before choosing a treatment.",
        arOverview: "قد ينتج تفاوت اللون عن التصبغ أو الاحمرار أو التعرض للشمس أو الالتهاب. تحديد السبب يسبق اختيار العلاج.",
        structures: ["Skin barrier", "Pigment cells", "Surface capillaries", "Sun-exposed skin"],
        arStructures: ["حاجز البشرة", "الخلايا الصبغية", "الشعيرات السطحية", "البشرة المعرضة للشمس"],
        procedures: ["Non-surgical aesthetics"],
        arProcedures: ["تجميل بدون جراحة"],
        discussed: ["Pigmentation assessment", "Redness and sensitivity", "Daily sun protection"],
        arDiscussed: ["تقييم التصبغ", "الاحمرار والحساسية", "الحماية اليومية من الشمس"],
        recovery: "Most skin plans are staged. Sensitivity and sun avoidance vary with the treatment selected.",
        arRecovery: "تُنفَّذ معظم خطط البشرة على مراحل. تختلف الحساسية ومدة تجنب الشمس حسب العلاج المختار.",
      },
      {
        id: "texture",
        en: "Texture & pores",
        ar: "الملمس والمسام",
        layer: "surface",
        at: [-0.28, 1.03, 0.38],
        overview: "Texture reflects the skin barrier, oil balance, collagen support, and previous inflammation. It improves through a plan, not a single product.",
        arOverview: "يعكس ملمس البشرة حاجز الجلد وتوازن الدهون ودعم الكولاجين والالتهاب السابق. يتحسن بخطة متكاملة لا بمنتج واحد.",
        structures: ["Skin barrier", "Oil glands", "Pore openings", "Collagen layer"],
        arStructures: ["حاجز البشرة", "الغدد الدهنية", "فتحات المسام", "طبقة الكولاجين"],
        procedures: ["Non-surgical aesthetics"],
        arProcedures: ["تجميل بدون جراحة"],
        discussed: ["Home skin routine", "Resurfacing options", "Acne control first"],
        arDiscussed: ["روتين العناية المنزلي", "خيارات تجديد السطح", "السيطرة على حب الشباب أولاً"],
        recovery: "Gentle plans have little downtime; resurfacing may need several days of redness and careful aftercare.",
        arRecovery: "الخطط اللطيفة لا تحتاج عادة إلى فترة تعافٍ، بينما قد يتطلب تجديد السطح عدة أيام من الاحمرار والعناية الدقيقة.",
      },
      {
        id: "scars-skin",
        en: "Scars & marks",
        ar: "الندبات والآثار",
        layer: "structure",
        at: [0.34, 0.83, 0.31],
        overview: "A scar is a change in structure, not only colour. Its depth, tethering, pigment, and age determine which combination of treatments may help.",
        arOverview: "الندبة تغير في بنية الجلد وليست في اللون فقط. يحدد عمقها وارتباطها ولونها وعمرها مجموعة العلاجات المناسبة.",
        structures: ["Epidermis", "Collagen fibres", "Scar tethering", "Underlying fat"],
        arStructures: ["البشرة", "ألياف الكولاجين", "ارتباط الندبة", "الدهون تحت الجلد"],
        procedures: ["Non-surgical aesthetics"],
        arProcedures: ["تجميل بدون جراحة"],
        discussed: ["Scar type and age", "Combination treatment", "Realistic improvement goals"],
        arDiscussed: ["نوع الندبة وعمرها", "العلاج المركب", "أهداف التحسن الواقعية"],
        recovery: "Scar treatment is gradual and usually needs a series. Progress is measured in months rather than days.",
        arRecovery: "علاج الندبات تدريجي ويحتاج غالباً إلى سلسلة جلسات. يُقاس التحسن بالأشهر لا بالأيام.",
      },
    ],
  },
];

export function findArea(id: AreaId): Area {
  return AREAS.find((area) => area.id === id) ?? AREAS[0];
}

/**
 * Which region a tooth click opens, by depth.
 *
 * Clicking a molar means something different depending on what you are looking
 * at: its crown at the surface, its root once the gums are cut away, the bone
 * it is anchored in below that. Mapping every click to one fixed region would
 * make the deeper views feel unresponsive.
 *
 * Kept here rather than in the canvas so the renderer holds no region ids.
 */
export const TOOTH_REGION: Record<LayerId, string> = {
  surface: "crown",
  structure: "root",
  skeleton: "implant",
};

/** The depth hint for this area, falling back to the general wording. */
export function layerHint(area: Area, layer: LayerId, rtl: boolean): string {
  const override = area.layerHints?.[layer];
  if (override) return rtl ? override.ar : override.en;
  const base = LAYERS.find((entry) => entry.id === layer) ?? LAYERS[0];
  return rtl ? base.arHint : base.hint;
}

/** Layers that actually carry a region in this area, in depth order. */
export function layersFor(area: Area): LayerId[] {
  const present = new Set(area.regions.map((region) => region.layer));
  return LAYERS.filter((layer) => present.has(layer.id)).map((layer) => layer.id);
}

/**
 * A region is visible once the viewer has cut to its depth or deeper.
 *
 * Surface regions stay visible at every layer — hiding the jawline the moment
 * someone looks at bone would make the deeper views feel emptier rather than
 * more informative, which is the opposite of the intent.
 */
export function regionsVisibleAt(area: Area, layer: LayerId): Region[] {
  const order: LayerId[] = ["surface", "structure", "skeleton"];
  const depth = order.indexOf(layer);
  return area.regions.filter((region) => order.indexOf(region.layer) <= depth);
}
