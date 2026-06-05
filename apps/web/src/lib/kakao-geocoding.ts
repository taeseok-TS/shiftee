/**
 * Kakao Map Geocoding API를 이용한 주소 -> GPS 좌표 변환
 * API Key: https://developers.kakao.com에서 REST API 키 발급 필요
 */

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  fullAddress: string;
}

/**
 * Kakao Geocoding API를 사용하여 주소를 GPS 좌표로 변환
 * @param address - 변환할 주소 (예: "서울시 강남구 테헤란로 123")
 * @returns { latitude, longitude, fullAddress } | null
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address.trim()) {
    throw new Error("주소를 입력해주세요.");
  }

  const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!apiKey) {
    throw new Error("Kakao Map API Key가 설정되지 않았습니다.");
  }

  try {
    const response = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
      {
        method: "GET",
        headers: {
          Authorization: `KakaoAK ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Kakao API Error: ${response.statusText}`);
    }

    const data = await response.json();

    // 검색 결과가 없는 경우
    if (!data.documents || data.documents.length === 0) {
      throw new Error("해당 주소를 찾을 수 없습니다. 주소를 다시 확인해주세요.");
    }

    // 첫 번째 결과 사용
    const result = data.documents[0];

    return {
      latitude: parseFloat(result.y), // 위도
      longitude: parseFloat(result.x), // 경도
      fullAddress: result.address_name, // 전체 주소
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`주소 검색 실패: ${error.message}`);
    }
    throw new Error("주소 검색 중 오류가 발생했습니다.");
  }
}

/**
 * Kakao Geocoding API를 사용하여 좌표를 주소로 변환 (역지오코딩)
 * @param latitude - 위도
 * @param longitude - 경도
 * @returns 주소 | null
 */
export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number
): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!apiKey) {
    console.error("Kakao Map API Key가 설정되지 않았습니다.");
    return null;
  }

  try {
    const response = await fetch(
      `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${longitude}&y=${latitude}`,
      {
        method: "GET",
        headers: {
          Authorization: `KakaoAK ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data.documents || data.documents.length === 0) {
      return null;
    }

    return data.documents[0].address.address_name;
  } catch (error) {
    console.error("역지오코딩 오류:", error);
    return null;
  }
}
