import { PaginationQueryDto } from '../dto/pagination-query.dto';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export function toSkipTake({ page, limit }: PaginationQueryDto): {
  skip: number;
  take: number;
} {
  return { skip: (page - 1) * limit, take: limit };
}

export function toPage<T>(
  items: T[],
  total: number,
  { page, limit }: PaginationQueryDto,
): Page<T> {
  return { items, total, page, limit };
}
