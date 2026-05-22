export interface RdaEntry {
  value: number;
  unit: 'g' | 'mg' | 'mcg' | 'mL';
}

export const RDA: Record<string, RdaEntry> = {
  fiber:            { value: 30,   unit: 'g'   },
  sodium:           { value: 2300, unit: 'mg'  },
  calcium:          { value: 1000, unit: 'mg'  },
  iron:             { value: 8,    unit: 'mg'  },
  vitamin_c:        { value: 90,   unit: 'mg'  },
  vitamin_d:        { value: 20,   unit: 'mcg' },
  vitamin_b12:      { value: 2.4,  unit: 'mcg' },
  magnesium:        { value: 420,  unit: 'mg'  },
  zinc:             { value: 11,   unit: 'mg'  },
  potassium:        { value: 3500, unit: 'mg'  },
  vitamin_a:        { value: 900,  unit: 'mcg' },
  vitamin_e:        { value: 15,   unit: 'mg'  },
  vitamin_k:        { value: 120,  unit: 'mcg' },
  thiamin:          { value: 1.2,  unit: 'mg'  },
  riboflavin:       { value: 1.3,  unit: 'mg'  },
  niacin:           { value: 16,   unit: 'mg'  },
  pantothenic_acid: { value: 5,    unit: 'mg'  },
  folate:           { value: 400,  unit: 'mcg' },
  copper:           { value: 0.9,  unit: 'mg'  },
  manganese:        { value: 2.3,  unit: 'mg'  },
  phosphorus:       { value: 700,  unit: 'mg'  },
  selenium:         { value: 55,   unit: 'mcg' },
  vitamin_b6:       { value: 1.3,  unit: 'mg'  },
  cholesterol:      { value: 300,  unit: 'mg'  },
  caffeine:         { value: 400,  unit: 'mg'  },
  water:            { value: 3000, unit: 'mL'  },
  // dietary_sugar, saturated_fat, polyunsaturated_fat, monounsaturated_fat intentionally omitted —
  // no standard RDA; they are "limit" or "adequate intake" nutrients rather than deficiency targets.
};
