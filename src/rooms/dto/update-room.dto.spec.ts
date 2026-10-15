import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRoomDto } from './update-room.dto';

const errorsFor = (body: object) =>
  validate(plainToInstance(UpdateRoomDto, body)).then((errors) =>
    errors.map((error) => error.property),
  );

describe('UpdateRoomDto: equipmentIds', () => {
  it('allows the field to be omitted', async () => {
    expect(await errorsFor({ capacity: 5 })).toEqual([]);
  });

  it('rejects an explicit null', async () => {
    expect(await errorsFor({ equipmentIds: null })).toEqual(['equipmentIds']);
  });
});
