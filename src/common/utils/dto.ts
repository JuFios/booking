// Omitted fields are undefined on a DTO instance
export function isEmptyUpdate(dto: object): boolean {
  return Object.values(dto).every((value) => value === undefined);
}
