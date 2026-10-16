import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoomDto } from './create-room.dto';

const errorsFor = (body: object) =>
  validate(plainToInstance(CreateRoomDto, body)).then((errors) =>
    errors.map((error) => error.property),
  );

const room = { name: 'Kyiv', capacity: 10, floor: 2 };

describe('CreateRoomDto: equipmentIds', () => {
  it('allows the field to be omitted', async () => {
    expect(await errorsFor(room)).toEqual([]);
  });

  it('rejects an explicit null', async () => {
    expect(await errorsFor({ ...room, equipmentIds: null })).toEqual([
      'equipmentIds',
    ]);
  });
});
