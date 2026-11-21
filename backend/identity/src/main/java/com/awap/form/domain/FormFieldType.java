package com.awap.form.domain;

/** Field types supported by the Form Service; SECTION and DIVIDER are layout-only. */
public enum FormFieldType {
  TEXT,
  TEXTAREA,
  NUMBER,
  EMAIL,
  PHONE,
  DATE,
  DATETIME,
  BOOLEAN,
  SELECT,
  MULTI_SELECT,
  FILE,
  /** Layout heading; never takes a value. */
  SECTION,
  /** Visual separator; never takes a value. */
  DIVIDER
}
